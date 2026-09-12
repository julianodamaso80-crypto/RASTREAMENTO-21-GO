import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CrmBoletosClient } from './crm-boletos.client';
import { PushService } from './push.service';
import { dentroDaJanelaDoSga } from './boletos.regras';

@Injectable()
export class BoletosSyncService {
  private readonly logger = new Logger(BoletosSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmBoletosClient,
    private readonly push: PushService,
  ) {}

  /**
   * 8h, 12h e 17h30 de Brasília. O cron dispara todo dia; quem barra sábado,
   * domingo e fora de hora é `dentroDaJanelaDoSga` — uma regra só, num lugar só.
   */
  @Cron('0 0,30 8,12,17 * * *', { timeZone: 'America/Sao_Paulo' })
  async rodadaAgendada(): Promise<void> {
    const agora = new Date();
    const hora = agora.getHours();
    const minuto = agora.getMinutes();
    // 8h00, 12h00 e 17h30 — as outras batidas do cron saem fora.
    const horaValida =
      (hora === 8 && minuto === 0) ||
      (hora === 12 && minuto === 0) ||
      (hora === 17 && minuto === 30);
    if (!horaValida) return;
    const r = await this.rodada(agora);
    this.logger.log(
      `boletos: ${r.associados} associados, ${r.gravados} gravados, ${r.pdfs} PDFs, ${r.apagados} apagados`,
    );
  }

  async rodada(agora: Date = new Date()): Promise<{
    associados: number; gravados: number; pdfs: number; apagados: number;
  }> {
    if (!dentroDaJanelaDoSga(agora)) {
      this.logger.log('fora da janela do SGA (seg–sex 7h–18h): rodada não executada');
      return { associados: 0, gravados: 0, pdfs: 0, apagados: 0 };
    }

    const associados = await this.prisma.associate.findMany({
      where: { deletedAt: null, lastLoginAt: { not: null } },
      select: { id: true, tenantId: true, cpf: true },
    });

    let gravados = 0;
    let pdfs = 0;
    let apagados = 0;
    for (const a of associados) {
      const r = await this.sincronizarAssociado(a);
      gravados += r.gravados;
      pdfs += r.pdfs;
      apagados += r.apagados;
    }
    return { associados: associados.length, gravados, pdfs, apagados };
  }

  /**
   * A carga de UM associado. O robô usa em laço; o primeiro acesso (Task 7B) usa
   * sozinha, para quem instalou o app agora não esperar a próxima batida do cron.
   */
  async sincronizarAssociado(a: {
    id: string; tenantId: string; cpf: string | null;
  }): Promise<{ gravados: number; pdfs: number; apagados: number }> {
    const cpf = String(a.cpf ?? '').replace(/\D/g, '');
    if (!cpf) return { gravados: 0, pdfs: 0, apagados: 0 };

    let gravados = 0;
    let pdfs = 0;
    const doCrm = await this.crm.buscarPorCpf(cpf);

    for (const b of doCrm) {
      const dados = {
        tenantId: a.tenantId,
        associateId: a.id,
        nossoNumero: b.nossoNumero,
        plate: b.placa,
        mesReferente: b.mesReferente,
        valor: b.valor,
        vencimento: b.vencimento,
        status: b.status,
        linhaDigitavel: b.linhaDigitavel,
      };
      const linha = await this.prisma.associateBoleto.upsert({
        where: { tenantId_nossoNumero: { tenantId: a.tenantId, nossoNumero: b.nossoNumero } },
        create: dados,
        update: dados,
      });
      gravados += 1;

      if (b.linkPdf) {
        const buf = await this.crm.baixarPdf(b.linkPdf);
        if (buf) {
          // new Uint8Array(buf): Buffer<ArrayBufferLike> não bate com o tipo
          // Bytes do Prisma (Uint8Array<ArrayBuffer>) no @types/node atual.
          const conteudo = new Uint8Array(buf);
          // Chave composta: `nosso_numero` não é único entre tenants — cada
          // cooperativa tem seu convênio bancário e a numeração pode colidir.
          await this.prisma.associateBoletoPdf.upsert({
            where: {
              tenantId_nossoNumero: { tenantId: a.tenantId, nossoNumero: b.nossoNumero },
            },
            create: { nossoNumero: b.nossoNumero, tenantId: a.tenantId, conteudo },
            update: { conteudo, baixadoEm: new Date() },
          });
          await this.prisma.associateBoleto.update({
            where: { id: linha.id },
            data: { pdfBytes: buf.length },
          });
          pdfs += 1;
        }
      }

      // Trava do push: uma vez por boleto, para sempre. Quem manda é a coluna.
      if (!linha.avisadoEm) {
        await this.push.avisarBoletoNovo(linha.id, a.id, a.tenantId, b);
      }
    }

    // Sumiu da lista do CRM = pagou ou passou dos 5 dias. Sai daqui também.
    const vivos = doCrm.map((b) => b.nossoNumero);
    const mortos = await this.prisma.associateBoleto.findMany({
      where: { tenantId: a.tenantId, associateId: a.id, nossoNumero: { notIn: vivos } },
      select: { nossoNumero: true },
    });
    const numeros = mortos.map((m) => m.nossoNumero);
    await this.prisma.associateBoletoPdf.deleteMany({
      where: { tenantId: a.tenantId, nossoNumero: { in: numeros } },
    });
    const apagou = await this.prisma.associateBoleto.deleteMany({
      where: { tenantId: a.tenantId, associateId: a.id, nossoNumero: { in: numeros } },
    });

    // Carimbo da visita: é ele que separa "está em dia" de "ainda não olhei".
    await this.prisma.associate.update({
      where: { id: a.id },
      data: { boletosSincronizadosEm: new Date() },
    });

    return { gravados, pdfs, apagados: apagou.count };
  }
}
