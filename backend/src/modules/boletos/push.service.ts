import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * O CRM manda `mesReferente` em dois formatos possíveis ("YYYY-MM" ou
 * "MM/YYYY") — sem o SGA aberto não dá pra provar qual chega em cada
 * caminho, então aceita os dois (achado I2). Lixo (vazio, nulo, mês fora de
 * 1–12) devolve null em vez de "mês NaN".
 */
function numeroDoMes(mesReferente: string | null): number | null {
  const m = String(mesReferente ?? '');
  let mes: number;
  if (/^\d{4}-\d{2}$/.test(m)) {
    mes = Number(m.slice(5, 7));
  } else if (/^\d{2}\/\d{4}$/.test(m)) {
    mes = Number(m.slice(0, 2));
  } else {
    return null;
  }
  return mes >= 1 && mes <= 12 ? mes : null;
}

/** A frase do push. Sem jargão, sem "mensalidade referente a competência". */
export function textoDoAviso(b: {
  mesReferente: string | null;
  valor: number | null;
  vencimento: string | null;
}): string {
  const mesNumero = numeroDoMes(b.mesReferente);
  const mes = mesNumero ? MESES[mesNumero - 1] : undefined;
  const deQualMes = mes ? ` de ${mes}` : '';
  if (b.valor == null) return `Seu boleto${deQualMes} já está disponível.`;
  const valor = b.valor.toFixed(2).replace('.', ',');
  const dia = String(b.vencimento ?? '').slice(8, 10);
  // integrador já devolveu vencimento sujo (ex.: "2026-09-XX") — só usa se for dia de verdade
  const quando = /^\d{2}$/.test(dia) ? `, vence dia ${Number(dia)}` : '';
  return `Seu boleto${deQualMes} já está disponível — R$ ${valor}${quando}.`;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  /**
   * ⚠️ `fetch` NÃO entra no construtor. O Nest apaga `typeof fetch` para `Function`
   * nos metadados e não acha token para injetar — o backend morre no boot com
   * "can't resolve dependencies". Provado na Task 5. Os testes trocam o `fetch`
   * global com `jest.spyOn(global, 'fetch')`.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async registrarAparelho(
    associateId: string,
    tenantId: string,
    expoToken: string,
    platform: string,
  ): Promise<void> {
    await this.prisma.associatePushDevice.upsert({
      where: { expoToken },
      create: { associateId, tenantId, expoToken, platform },
      update: { associateId, tenantId, platform },
    });
  }

  /**
   * Um aviso por boleto, para sempre. O carimbo só cai DEPOIS do envio dar certo:
   * carimbar antes transformaria uma falha de rede em associado que nunca soube.
   */
  async avisarBoletoNovo(
    boletoId: string,
    associateId: string,
    tenantId: string,
    b: { mesReferente: string | null; valor: number | null; vencimento: string | null },
  ): Promise<void> {
    const aparelhos = await this.prisma.associatePushDevice.findMany({
      where: { associateId, tenantId },
      select: { expoToken: true },
    });
    if (!aparelhos.length) return;

    // Interruptor de emergência (achado M9): a config existia e ninguém a
    // lia. Não carimba — quando religar, o robô tenta de novo pra quem
    // ainda não foi avisado deste boleto.
    if (this.config.get<boolean>('expoPush.enabled') === false) {
      this.logger.warn('push de boletos desligado (expoPush.enabled=false)');
      return;
    }

    const url = this.config.get<string>('expoPush.url') ?? 'https://exp.host/--/api/v2/push/send';
    const mensagens = aparelhos.map((a) => ({
      to: a.expoToken,
      title: '21 Tracker',
      body: textoDoAviso(b),
      data: { rota: '/boletos' },
    }));

    let tickets: Array<{ status?: string; details?: { error?: string } }> = [];
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mensagens),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        // Expo recusou (payload malformado, token inválido, limite): não carimba, o robô tenta de novo
        this.logger.warn(`Expo respondeu ${r.status} ao enviar push`);
        return;
      }
      // Achado I5: a Expo responde HTTP 200 mesmo com ticket individual em
      // erro (ex.: `{"data":[{"status":"error","details":{"error":"DeviceNotRegistered"}}]}`)
      // — só `r.ok` não prova que o push chegou.
      const body = (await r.json()) as { data?: typeof tickets };
      tickets = Array.isArray(body?.data) ? body.data : [];
    } catch (err) {
      this.logger.warn(`push não saiu: ${(err as Error).message}`);
      return;
    }

    // Token morto não serve mais pra nada: apaga pra parar de tentar.
    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i];
      if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered') {
        const tokenMorto = aparelhos[i]?.expoToken;
        if (tokenMorto) {
          await this.prisma.associatePushDevice.deleteMany({ where: { expoToken: tokenMorto } });
        }
      }
    }

    const algumTicketDeuCerto = tickets.some((t) => t?.status === 'ok');
    if (!algumTicketDeuCerto) {
      // Nenhum ticket confirmou: não carimba, senão este boleto nunca mais avisa ninguém.
      this.logger.warn('Expo não confirmou nenhum ticket do push');
      return;
    }

    await this.prisma.associateBoleto.update({
      where: { id: boletoId },
      data: { avisadoEm: new Date() },
    });
  }
}
