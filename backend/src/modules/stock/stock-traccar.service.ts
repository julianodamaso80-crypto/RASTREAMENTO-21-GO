import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  TraccarService,
  type TraccarDevice,
  type TraccarPosition,
} from '../traccar/traccar.service';
import { assessPosition } from '../traccar/position-quality';
import {
  COMUNICANDO_MS,
  FIX_FRESCO_MS,
  classificarEnergia,
  extrairVolts,
  type FaixaEnergia,
} from '../traccar/device-health.service';

/**
 * Mantém o estoque inteiro cadastrado no servidor GPS.
 *
 * Até 2026-08-10 o rastreador só passava a existir no Traccar no momento em que
 * era vinculado a um cliente. Enquanto estava em estoque ele transmitia pro
 * `gps1.trackgo.site` e o Traccar descartava tudo, por não saber de quem era —
 * então não havia como conferir instalação ANTES de vincular no SGA, que é
 * justamente quando a conferência importa.
 *
 * Com o device criado desde a importação da planilha, o estoque ganha os cards
 * de conectividade (Conectados / Desconectados / Sem sinal GPS) e o painel de
 * validação tem o que mostrar.
 *
 * O device nasce com o IMEI como nome; ao ser vinculado, o `associate()`
 * renomeia pra placa.
 */
@Injectable()
export class StockTraccarService {
  private readonly logger = new Logger(StockTraccarService.name);

  /** Teto por rodada do cron — não prender o event loop numa carga grande. */
  private static readonly LOTE_CRON = 200;

  /** Chamadas em paralelo contra o Traccar. Acima disso ele começa a recusar. */
  private static readonly CONCORRENCIA = 5;

  private cache: { at: number; devices: DeviceSnapshot[] } | null = null;
  private static readonly CACHE_MS = 30 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly traccar: TraccarService,
  ) {}

  /**
   * Garante o device no Traccar e grava o id no item. Best-effort: devolve
   * `null` se o Traccar estiver fora, sem derrubar quem chamou.
   */
  async ensureDevice(item: {
    id: string;
    imei: string;
    traccarDeviceId: number | null;
  }): Promise<number | null> {
    if (item.traccarDeviceId) return item.traccarDeviceId;
    try {
      const existente = await this.traccar.getDeviceByUniqueId(item.imei);
      const device =
        existente ?? (await this.traccar.createDevice(item.imei, item.imei));
      if (!device?.id) return null;
      await this.prisma.stockItem.update({
        where: { id: item.id },
        data: { traccarDeviceId: device.id },
      });
      return device.id;
    } catch (erro) {
      this.logger.warn(
        `Não consegui cadastrar o IMEI ${item.imei} no Traccar: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
      return null;
    }
  }

  /**
   * Cadastra no Traccar os itens do estoque que ainda não têm device.
   * Chamado pela importação de planilha (em segundo plano) e pelo cron.
   */
  async ensurePending(tenantId?: string, limite = 500): Promise<number> {
    const pendentes = await this.prisma.stockItem.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        deletedAt: null,
        associatedAt: null,
        traccarDeviceId: null,
      },
      select: { id: true, imei: true, traccarDeviceId: true },
      take: limite,
      orderBy: { createdAt: 'desc' },
    });
    if (pendentes.length === 0) return 0;

    let ok = 0;
    for (
      let i = 0;
      i < pendentes.length;
      i += StockTraccarService.CONCORRENCIA
    ) {
      const lote = pendentes.slice(i, i + StockTraccarService.CONCORRENCIA);
      const ids = await Promise.all(
        lote.map((item) => this.ensureDevice(item)),
      );
      ok += ids.filter((id) => id !== null).length;
    }

    this.logger.log(
      `Estoque no servidor GPS: ${ok}/${pendentes.length} cadastrado(s).`,
    );
    return ok;
  }

  /** Rede de segurança pra quem entrou enquanto o Traccar estava fora. */
  @Interval(30 * 60 * 1000)
  async cronSincronizar(): Promise<void> {
    try {
      await this.ensurePending(undefined, StockTraccarService.LOTE_CRON);
    } catch (erro) {
      this.logger.warn(
        `Sincronização do estoque com o Traccar falhou: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
    }
  }

  /**
   * Conectividade do estoque do tenant: contadores dos cards e o estado item a
   * item, pra lista pintar o pontinho.
   *
   * Duas chamadas ao Traccar cobrem a frota inteira (`/devices` e `/positions`
   * sem filtro devolvem tudo), com cache curto porque a tela recarrega sozinha
   * e vários operadores podem estar olhando ao mesmo tempo.
   */
  async connectivity(tenantId: string): Promise<StockConnectivity> {
    const itens = await this.prisma.stockItem.findMany({
      where: { tenantId, deletedAt: null, associatedAt: null },
      select: { imei: true },
    });

    let snapshot: DeviceSnapshot[];
    try {
      snapshot = await this.snapshot();
    } catch (erro) {
      this.logger.warn(
        `Traccar indisponível ao montar a conectividade do estoque: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
      return {
        indisponivel: true,
        total: itens.length,
        conectados: 0,
        desconectados: 0,
        semGps: 0,
        semCadastro: 0,
        statuses: {},
      };
    }

    const porImei = new Map(snapshot.map((d) => [d.uniqueId, d]));
    const statuses: Record<string, StockConnectivityItem> = {};
    let conectados = 0;
    let desconectados = 0;
    let semGps = 0;
    let semCadastro = 0;

    for (const { imei } of itens) {
      const device = porImei.get(imei);
      if (!device) {
        semCadastro++;
        statuses[imei] = {
          conhecido: false,
          comunicando: false,
          gpsOk: false,
          lastUpdate: null,
        };
        continue;
      }
      if (device.comunicando) conectados++;
      else desconectados++;
      // "Sem sinal GPS" conta só quem está falando: rastreador desligado já foi
      // contado como desconectado, e somar de novo inflaria o número.
      if (device.comunicando && !device.gpsOk) semGps++;
      statuses[imei] = {
        conhecido: true,
        comunicando: device.comunicando,
        gpsOk: device.gpsOk,
        lastUpdate: device.lastUpdate,
      };
    }

    return {
      indisponivel: false,
      total: itens.length,
      conectados,
      desconectados,
      semGps,
      semCadastro,
      statuses,
    };
  }

  /**
   * Estoque no mapa: cada rastreador com a última posição conhecida e a
   * telemetria do momento.
   *
   * Mostra a última posição MESMO velha (rastreador na prateleira reportou pela
   * última vez há dias) — com `idadeSegundos` e `gpsConfiavel` explícitos, pra
   * tela nunca vender posição velha como atual. É o que o operador precisa pra
   * saber onde o equipamento está: pode estar com o técnico a caminho.
   */
  async mapPoints(tenantId: string): Promise<StockMapResult> {
    const itens = await this.prisma.stockItem.findMany({
      where: { tenantId, deletedAt: null, associatedAt: null },
      select: {
        id: true,
        imei: true,
        iccid: true,
        line: true,
        operator: true,
        server: true,
        status: true,
        validatedAt: true,
        validationOk: true,
        assignedTechnician: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    let devices: TraccarDevice[];
    let positions: TraccarPosition[];
    try {
      [devices, positions] = await Promise.all([
        this.traccar.getDevices(),
        this.traccar.getPositions(),
      ]);
    } catch (erro) {
      this.logger.warn(
        `Traccar indisponível ao montar o mapa do estoque: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
      return { indisponivel: true, pontos: [] };
    }

    const porImei = new Map(devices.map((d) => [d.uniqueId, d]));
    const porDeviceId = new Map(positions.map((p) => [p.deviceId, p]));
    const agora = Date.now();

    const pontos = itens.map((item): StockMapPoint => {
      const device = porImei.get(item.imei);
      const posicao = device ? porDeviceId.get(device.id) : undefined;
      const attrs = posicao?.attributes ?? {};

      const lastUpdate = device?.lastUpdate ?? null;
      const idadeComunicacao =
        lastUpdate && Number.isFinite(Date.parse(lastUpdate))
          ? Math.round((agora - Date.parse(lastUpdate)) / 1000)
          : null;

      const fixTime = posicao?.fixTime || posicao?.deviceTime || null;
      const idadeSegundos =
        fixTime && Number.isFinite(Date.parse(fixTime))
          ? Math.max(0, Math.round((agora - Date.parse(fixTime)) / 1000))
          : null;

      const gpsConfiavel = posicao
        ? assessPosition(posicao, agora).trustworthy
        : false;

      const satBruto = attrs.sat ?? attrs.satellites ?? null;

      return {
        id: item.id,
        imei: item.imei,
        iccid: item.iccid,
        line: item.line,
        operator: item.operator,
        server: item.server,
        statusChip: item.status,
        validatedAt: item.validatedAt ? item.validatedAt.toISOString() : null,
        validationOk: item.validationOk,
        tecnico: item.assignedTechnician?.name ?? null,
        conexao: this.classificarConexao(device, attrs, idadeComunicacao),
        lastUpdate,
        fixTime,
        idadeSegundos,
        latitude: posicao?.latitude ?? null,
        longitude: posicao?.longitude ?? null,
        endereco: posicao?.address ?? null,
        gpsConfiavel,
        ignicao: typeof attrs.ignition === 'boolean' ? attrs.ignition : null,
        velocidade: typeof posicao?.speed === 'number' ? posicao.speed : null,
        direcao: typeof posicao?.course === 'number' ? posicao.course : null,
        volts: extrairVolts(attrs),
        faixaEnergia: classificarEnergia(extrairVolts(attrs), {
          charge: attrs.charge,
          powerCut: attrs.powerCut,
        }).faixa,
        satelites: satBruto && satBruto > 0 ? satBruto : null,
        bateriaInterna:
          typeof attrs.batteryLevel === 'number' ? attrs.batteryLevel : null,
        bloqueado: attrs.blocked === true,
      };
    });

    return { indisponivel: false, pontos };
  }

  /**
   * ONLINE / SLEEP / OFFLINE / NUNCA, na linguagem do operador.
   *
   * `SLEEP` sai do atributo que o próprio equipamento reporta — não é derivado
   * de "faz tempo que não fala", que seria chute. No parque de hoje ninguém
   * reporta sleep, então o contador fica em zero, igual ao da referência.
   */
  private classificarConexao(
    device: TraccarDevice | undefined,
    attrs: Record<string, unknown>,
    idadeComunicacao: number | null,
  ): StockConexao {
    if (!device) return 'NUNCA';
    if (attrs.sleep === true) return 'SLEEP';
    if (device.status === 'online') return 'ONLINE';
    if (
      idadeComunicacao !== null &&
      idadeComunicacao * 1000 <= COMUNICANDO_MS
    ) {
      return 'ONLINE';
    }
    return device.lastUpdate ? 'OFFLINE' : 'NUNCA';
  }

  /** Retrato da frota no Traccar, com cache de 30s. */
  private async snapshot(): Promise<DeviceSnapshot[]> {
    const agora = Date.now();
    if (this.cache && agora - this.cache.at < StockTraccarService.CACHE_MS) {
      return this.cache.devices;
    }

    const [devices, positions] = await Promise.all([
      this.traccar.getDevices(),
      this.traccar.getPositions(),
    ]);

    const posicaoPorDevice = new Map(positions.map((p) => [p.deviceId, p]));
    const snapshot: DeviceSnapshot[] = devices.map((device) => {
      const posicao = posicaoPorDevice.get(device.id);
      const lastUpdate = device.lastUpdate ?? null;
      const comunicando =
        device.status === 'online' ||
        (lastUpdate !== null &&
          Number.isFinite(Date.parse(lastUpdate)) &&
          agora - Date.parse(lastUpdate) <= COMUNICANDO_MS);

      let gpsOk = false;
      if (posicao) {
        const fix = posicao.fixTime || posicao.deviceTime;
        const idade = fix ? agora - Date.parse(fix) : Infinity;
        gpsOk =
          assessPosition(posicao, agora).trustworthy &&
          Number.isFinite(idade) &&
          idade <= FIX_FRESCO_MS;
      }

      return { uniqueId: device.uniqueId, comunicando, gpsOk, lastUpdate };
    });

    this.cache = { at: agora, devices: snapshot };
    return snapshot;
  }
}

interface DeviceSnapshot {
  uniqueId: string;
  comunicando: boolean;
  gpsOk: boolean;
  lastUpdate: string | null;
}

export interface StockConnectivityItem {
  /** O IMEI existe como device no servidor GPS. */
  conhecido: boolean;
  comunicando: boolean;
  gpsOk: boolean;
  lastUpdate: string | null;
}

export type StockConexao = 'ONLINE' | 'OFFLINE' | 'SLEEP' | 'NUNCA';

export interface StockMapPoint {
  id: string;
  imei: string;
  iccid: string | null;
  line: string | null;
  operator: string | null;
  server: string | null;
  /** Status comercial do chip vindo da planilha (ATIVO, SUSPENSO...). */
  statusChip: string | null;
  validatedAt: string | null;
  validationOk: boolean | null;
  tecnico: string | null;
  conexao: StockConexao;
  lastUpdate: string | null;
  fixTime: string | null;
  /** Idade da posição, em segundos. A tela mostra pra ninguém confundir
   *  última posição conhecida com posição atual. */
  idadeSegundos: number | null;
  latitude: number | null;
  longitude: number | null;
  endereco: string | null;
  /** A posição passa no juiz de qualidade (não é LBS, não é null island). */
  gpsConfiavel: boolean;
  ignicao: boolean | null;
  velocidade: number | null;
  direcao: number | null;
  volts: number | null;
  faixaEnergia: FaixaEnergia;
  satelites: number | null;
  bateriaInterna: number | null;
  bloqueado: boolean;
}

export interface StockMapResult {
  indisponivel: boolean;
  pontos: StockMapPoint[];
}

export interface StockConnectivity {
  /** Traccar fora do ar — os contadores não valem nada, a tela precisa avisar. */
  indisponivel: boolean;
  total: number;
  conectados: number;
  desconectados: number;
  semGps: number;
  semCadastro: number;
  statuses: Record<string, StockConnectivityItem>;
}
