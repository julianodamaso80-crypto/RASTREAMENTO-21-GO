import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';

/**
 * Aponta sozinho, por SMS, o rastreador instalado que nunca falou com o servidor.
 *
 * Em 16/11/2026 havia 863 veículos ativos nessa situação: aparelhos do lote
 * J16 + chip Algar saíam da caixa sem apontar pra cá, a instalação era aceita e
 * o associado via "OFFLINE · Aguardando primeira posição" desde o primeiro dia.
 * O SMS `SERVER,0,<ip>,<porta>,0#` resolve em minutos (RLG3I69: 4 min), mas
 * dependia de alguém lembrar de mandar.
 *
 * Só o formato IP funciona nesse firmware; o formato DNS é ignorado (medido em
 * 28/08, 01/09 e 11/11). Cada SMS custa ~R$ 1, por isso os limites abaixo.
 */
const MIN = 60 * 1000;
const HORA = 60 * MIN;
/** Atraso de cada tentativa, contado da instalação. */
const AGENDA_MS = [10 * MIN, 6 * HORA, 24 * HORA, 72 * HORA];
const INTERVALO_MINIMO_MS = HORA;
const JANELA_MS = 10 * 24 * HORA;
const MAX_POR_RODADA = 15;
const REMETENTE = 'apontamento-automatico';

export function comandoServidor(ip: string, porta: number): string {
  return `SERVER,0,${ip},${porta},0#`;
}

export function numeroDoChip(linha: string | null | undefined): string | null {
  const digitos = (linha ?? '').replace(/\D/g, '');
  const comPais = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
  return /^55\d{10,11}$/.test(comPais) ? comPais : null;
}

export function horaDeTentar(instaladoEm: Date, tentativas: Date[], agora: Date): boolean {
  if (tentativas.length >= AGENDA_MS.length) return false;
  const ultima = Math.max(0, ...tentativas.map((t) => t.getTime()));
  if (agora.getTime() - ultima < INTERVALO_MINIMO_MS) return false;
  return agora.getTime() - instaladoEm.getTime() >= AGENDA_MS[tentativas.length];
}

@Injectable()
export class StockApontamentoService {
  private readonly logger = new Logger(StockApontamentoService.name);
  private rodando = false;
  /** Trocável no teste. */
  enviarHttp: typeof fetch = (...args) => fetch(...args);

  constructor(
    private readonly prisma: PrismaService,
    private readonly traccar: TraccarService,
  ) {}

  @Interval(5 * MIN)
  async cron(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.rodar(new Date());
    } catch (error) {
      this.logger.warn(
        `Apontamento automático falhou: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      this.rodando = false;
    }
  }

  async rodar(agora: Date): Promise<{ enviados: number; falhas: number; semNumero: number }> {
    const resumo = { enviados: 0, falhas: 0, semNumero: 0 };
    const token = process.env.GTISMS_TOKEN;
    if (process.env.APONTAMENTO_AUTO !== '1' || !token) return resumo;

    const devices = await this.prisma.device.findMany({
      where: {
        status: 'INSTALLED',
        deletedAt: null,
        lastConnection: null,
        installedAt: { gte: new Date(agora.getTime() - JANELA_MS) },
        vehicle: { deletedAt: null, status: 'ACTIVE' },
        tenant: { isDemo: false },
      },
      select: { id: true, imei: true, tenantId: true, installedAt: true },
    });
    if (devices.length === 0) return resumo;

    const [tentativas, itens] = await Promise.all([
      this.prisma.smsCommand.findMany({
        where: { deviceId: { in: devices.map((d) => d.id) }, sentBy: REMETENTE },
        select: { deviceId: true, createdAt: true },
      }),
      this.prisma.stockItem.findMany({
        // TAG não tem chip nem servidor: fora.
        where: { imei: { in: devices.map((d) => d.imei) }, deletedAt: null, kind: 'RASTREADOR' },
        select: { imei: true, tenantId: true, line: true },
      }),
    ]);
    const linhaDe = new Map(itens.map((i) => [`${i.tenantId}:${i.imei}`, i.line]));

    const comando = comandoServidor(
      process.env.APONTAMENTO_IP ?? '167.71.31.77',
      Number(process.env.APONTAMENTO_PORTA ?? 5023),
    );

    for (const device of devices) {
      if (resumo.enviados + resumo.falhas >= MAX_POR_RODADA) break;
      if (!device.installedAt) continue;
      const feitas = tentativas
        .filter((t) => t.deviceId === device.id)
        .map((t) => t.createdAt);
      if (!horaDeTentar(device.installedAt, feitas, agora)) continue;

      const numero = numeroDoChip(linhaDe.get(`${device.tenantId}:${device.imei}`));
      if (!numero) {
        resumo.semNumero++;
        continue;
      }
      // `lastConnection` só é gravado pra quem está no mapa do tempo real;
      // quem decide se o aparelho já falou é o servidor GPS.
      const noTraccar = await this.traccar.getDeviceByUniqueId(device.imei);
      if (noTraccar?.lastUpdate) continue;

      const { ok, detalhe } = await this.enviar(token, numero, comando);
      await this.prisma.smsCommand.create({
        data: {
          deviceId: device.id,
          tenantId: device.tenantId,
          command: comando,
          type: 'SET_SERVER_IP',
          status: ok ? 'SENT' : 'FAILED',
          sentAt: ok ? agora : null,
          response: detalhe,
          sentBy: REMETENTE,
        },
      });
      if (ok) resumo.enviados++;
      else resumo.falhas++;
    }

    if (resumo.enviados || resumo.falhas || resumo.semNumero) {
      this.logger.log(
        `Apontamento automático: ${resumo.enviados} SMS enviado(s), ${resumo.falhas} falha(s), ${resumo.semNumero} sem número do chip.`,
      );
    }
    return resumo;
  }

  private async enviar(
    token: string,
    numero: string,
    comando: string,
  ): Promise<{ ok: boolean; detalhe: string }> {
    try {
      const resposta = await this.enviarHttp('https://sms.gtisms.com/api/v3/sms/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          recipient: numero,
          sender_id: '21GO',
          type: 'plain',
          message: comando,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const corpo = (await resposta.json()) as {
        status?: string;
        message?: string;
        data?: { id?: number; status?: string };
      };
      const ok = resposta.ok && corpo.status === 'success';
      return {
        ok,
        detalhe: ok
          ? `GTI ${corpo.data?.status ?? ''} id ${corpo.data?.id ?? ''}`.trim()
          : `GTI recusou: ${corpo.message ?? resposta.status}`,
      };
    } catch (error) {
      return { ok: false, detalhe: `GTI erro: ${error instanceof Error ? error.message : error}` };
    }
  }
}
