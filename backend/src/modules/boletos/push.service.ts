import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** A frase do push. Sem jargão, sem "mensalidade referente a competência". */
export function textoDoAviso(b: {
  mesReferente: string | null;
  valor: number | null;
  vencimento: string | null;
}): string {
  const mesNumero = Number(String(b.mesReferente ?? '').slice(0, 2));
  const mes = MESES[mesNumero - 1];
  const deQualMes = mes ? ` de ${mes}` : '';
  if (b.valor == null) return `Seu boleto${deQualMes} já está disponível.`;
  const valor = b.valor.toFixed(2).replace('.', ',');
  const dia = String(b.vencimento ?? '').slice(8, 10);
  const quando = dia ? `, vence dia ${Number(dia)}` : '';
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

    const url = this.config.get<string>('expoPush.url') ?? 'https://exp.host/--/api/v2/push/send';
    const mensagens = aparelhos.map((a) => ({
      to: a.expoToken,
      title: '21 Tracker',
      body: textoDoAviso(b),
      data: { rota: '/boletos' },
    }));

    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mensagens),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      this.logger.warn(`push não saiu: ${(err as Error).message}`);
      return;
    }

    await this.prisma.associateBoleto.update({
      where: { id: boletoId },
      data: { avisadoEm: new Date() },
    });
  }
}
