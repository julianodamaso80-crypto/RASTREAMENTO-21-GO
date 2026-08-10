import { Injectable, Logger } from '@nestjs/common';
import { TraccarService, type TraccarPosition } from './traccar.service';
import { assessPosition, distanceMeters } from './position-quality';

/**
 * Diagnóstico de saúde de um rastreador, pelo IMEI.
 *
 * Existe porque "o rastreador está instalado direito?" é a mesma pergunta no
 * painel (operador conferindo antes de vincular no SGA) e no PWA do técnico
 * (instalador conferindo antes de finalizar). Até 2026-08-10 só o técnico tinha
 * uma resposta — e ela olhava apenas GPS, ignorando as duas coisas que provam a
 * instalação elétrica: a VOLTAGEM (fio de alimentação no lugar certo) e a
 * IGNIÇÃO (fio de ignição no lugar certo).
 *
 * Regra do projeto que este arquivo respeita: heartbeat NÃO é GPS. `comunicando`
 * responde pelo chip; `gps.ok` responde pela antena. Misturar os dois esconde
 * rastreador com antena arrancada. Ver feedback_rastreamento_realtime_sem_heartbeat.
 */

/** Acima disso a posição não serve pra confirmar instalação. */
export const FIX_FRESCO_MS = 5 * 60 * 1000;

/** Sem pacote nesse tempo, o chip está mudo. */
export const COMUNICANDO_MS = 5 * 60 * 1000;

/** Fix 3D exige 4 satélites. Só reprova quando o equipamento REPORTA menos. */
export const MIN_SATELITES = 4;

/** Fronteira entre sistema de 12 V e de 24 V (caminhão/ônibus). */
export const CORTE_24V = 18;

export const FAIXA_12V = { min: 11.5, max: 15.0 };
export const FAIXA_24V = { min: 23.0, max: 30.0 };

/** Distância máxima entre rastreador e quem está conferindo em campo. */
export const DISTANCIA_MAX_M = 500;

/**
 * `sem-leitura`: o equipamento confirma que está alimentado pelo veículo, mas
 * não mede tensão (caso do gt06/J16). Passa na conferência — mas a tela avisa.
 * `cortada`: evidência de que a alimentação caiu. `ausente`: silêncio total.
 */
export type FaixaEnergia =
  | 'ok'
  | 'baixa'
  | 'alta'
  | 'sem-leitura'
  | 'cortada'
  | 'ausente';

export interface EnergiaDiagnostico {
  /** Tensão da bateria do veículo, em volts. `null` = não reportada. */
  volts: number | null;
  sistema: '12V' | '24V' | null;
  faixa: FaixaEnergia;
  /** Bateria interna do rastreador (%), quando o protocolo reporta. */
  bateriaInterna: number | null;
}

export interface GpsDiagnostico {
  ok: boolean;
  fixTime: string | null;
  idadeSegundos: number | null;
  satellites: number | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

export interface DeviceHealth {
  imei: string;
  /** O IMEI existe como device no servidor GPS. */
  encontradoNoGps: boolean;
  /** Já chegou algum pacote deste equipamento, alguma vez. */
  jaReportou: boolean;
  /** Chip conversando com o servidor agora (heartbeat — NÃO é GPS). */
  comunicando: boolean;
  lastUpdate: string | null;
  gps: GpsDiagnostico;
  energia: EnergiaDiagnostico;
  ignicao: { reportada: boolean; ligada: boolean | null };
  velocidade: number | null;
  /** Rumo em graus, como o Traccar entrega. */
  direcao: number | null;
  /** Distância até a coordenada de referência, quando informada. */
  distanceM: number | null;
  /** Passou em tudo: comunicando + GPS real + energia ok + ignição reportada. */
  checkOk: boolean;
  /** Frases prontas pra tela, na linguagem de quem instala. */
  motivos: string[];
  /** Servidor GPS indisponível — nada aqui dentro é confiável. */
  indisponivel: boolean;
}

export interface DiagnoseOptions {
  /** Coordenada de quem está conferindo (celular do técnico). */
  refLat?: number;
  refLng?: number;
  /** Cria o device no Traccar se ainda não existir (estoque nunca validado). */
  ensureDevice?: boolean;
}

/**
 * Nomes de atributo que já vimos carregando a tensão da bateria do veículo.
 * Varia por protocolo e por firmware; o primeiro que existir vale.
 */
const CHAVES_VOLTAGEM = [
  'power',
  'powerVoltage',
  'batteryVoltage',
  'externalPower',
  'externalPowerVoltage',
  'adc1',
] as const;

/**
 * Volts a partir dos atributos da posição. Protocolo que reporta em milivolts
 * (12630) apareceria como tensão absurda; acima de 100 divide por mil.
 */
export function normalizarVolts(bruto: unknown): number | null {
  if (typeof bruto !== 'number' || !Number.isFinite(bruto) || bruto <= 0) {
    return null;
  }
  const volts = bruto > 100 ? bruto / 1000 : bruto;
  return Math.round(volts * 100) / 100;
}

/** Procura a tensão entre os nomes conhecidos. */
export function extrairVolts(attrs: Record<string, unknown>): number | null {
  for (const chave of CHAVES_VOLTAGEM) {
    const volts = normalizarVolts(attrs[chave]);
    if (volts !== null) return volts;
  }
  return null;
}

/**
 * Classifica a alimentação do rastreador.
 *
 * Medido em produção (10/08/2026): em 50.749 posições do parque atual, todas do
 * protocolo **gt06** (os J16), o atributo `power` NUNCA veio — a tensão em volts
 * simplesmente não faz parte do que esse equipamento manda. O que ele manda é
 * `charge` (alimentação externa presente) e `batteryLevel`. Reprovar por
 * "não reporta voltagem" reprovaria 100% do parque, todo dia, sem defeito nenhum.
 *
 * Por isso a regra tem dois níveis:
 * - **Com volts:** confere a faixa de verdade (12 V ou 24 V, detectado sozinho).
 * - **Sem volts:** aceita a evidência indireta — `charge`/`powerCut` dizem se a
 *   alimentação do veículo está chegando. Vira `sem-leitura`, que passa na
 *   conferência mas deixa claro na tela que ninguém mediu a tensão.
 *
 * Só reprova com evidência NEGATIVA: tensão fora de faixa ou corte de energia.
 */
export function classificarEnergia(
  volts: number | null,
  sinais: { charge?: unknown; powerCut?: unknown } = {},
): { sistema: '12V' | '24V' | null; faixa: FaixaEnergia } {
  if (volts !== null) {
    const sistema = volts > CORTE_24V ? '24V' : '12V';
    const faixa = sistema === '24V' ? FAIXA_24V : FAIXA_12V;
    if (volts < faixa.min) return { sistema, faixa: 'baixa' };
    if (volts > faixa.max) return { sistema, faixa: 'alta' };
    return { sistema, faixa: 'ok' };
  }

  // Corte de energia é evidência negativa direta: o fio de alimentação caiu.
  if (sinais.powerCut === true) return { sistema: null, faixa: 'cortada' };
  if (sinais.charge === true) return { sistema: null, faixa: 'sem-leitura' };
  if (sinais.charge === false) return { sistema: null, faixa: 'cortada' };
  return { sistema: null, faixa: 'ausente' };
}

@Injectable()
export class DeviceHealthService {
  private readonly logger = new Logger(DeviceHealthService.name);

  constructor(private readonly traccar: TraccarService) {}

  async diagnose(
    imei: string,
    options: DiagnoseOptions = {},
  ): Promise<DeviceHealth> {
    const base = this.vazio(imei);

    let device: Awaited<ReturnType<TraccarService['getDeviceByUniqueId']>>;
    try {
      device = await this.traccar.getDeviceByUniqueId(imei);
    } catch (erro) {
      this.logger.warn(
        `Traccar indisponível ao diagnosticar ${imei}: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
      return {
        ...base,
        indisponivel: true,
        motivos: ['servidor GPS indisponível — tente de novo em instantes'],
      };
    }

    // Rastreador que nunca foi cadastrado no servidor GPS não tem como ser
    // conferido: o Traccar descarta tudo que ele manda. Criar aqui faz o
    // próximo pacote (segundos, num GT06 ligado) já valer.
    if (!device && options.ensureDevice) {
      try {
        device = await this.traccar.createDevice(imei, imei);
        this.logger.log(`Device criado no Traccar sob demanda: ${imei}`);
      } catch (erro) {
        this.logger.warn(
          `Não consegui criar o device ${imei} no Traccar: ${
            erro instanceof Error ? erro.message : erro
          }`,
        );
      }
    }

    if (!device) {
      return {
        ...base,
        motivos: ['rastreador ainda não apareceu no servidor GPS'],
      };
    }

    const comunicando = this.estaComunicando(device.status, device.lastUpdate);

    let posicao: TraccarPosition | undefined;
    try {
      const posicoes = await this.traccar.getPositions(device.id);
      posicao = posicoes[posicoes.length - 1];
    } catch {
      posicao = undefined;
    }

    if (!posicao) {
      return {
        ...base,
        encontradoNoGps: true,
        comunicando,
        lastUpdate: device.lastUpdate ?? null,
        motivos: [
          comunicando
            ? 'chip conectado, mas o GPS ainda não mandou posição — aguarde a céu aberto'
            : 'esse equipamento ainda não se conectou',
        ],
      };
    }

    const qualidade = assessPosition(posicao);
    const fix = posicao.fixTime || posicao.deviceTime || null;
    const idadeMs = fix ? Date.now() - Date.parse(fix) : Infinity;
    const idadeSegundos = Number.isFinite(idadeMs)
      ? Math.max(0, Math.round(idadeMs / 1000))
      : null;
    const fixFresco = Number.isFinite(idadeMs) && idadeMs <= FIX_FRESCO_MS;

    const attrs = posicao.attributes ?? {};
    // `sat: 0` no gt06 é campo não preenchido, não "zero satélites" — medido em
    // produção: a mesma sessão alterna entre sat 15 e sat 0 sem perder o fix.
    // Tratar como ausente evita semáforo piscando sem defeito nenhum.
    const satBruto = attrs.sat ?? attrs.satellites ?? null;
    const satellites = satBruto && satBruto > 0 ? satBruto : null;
    // Satélite ausente não reprova: muitos protocolos simplesmente não mandam.
    // Reprova quem REPORTA menos de 4 — aí o próprio aparelho está dizendo que
    // não tem fix 3D.
    const satelitesOk = satellites === null || satellites >= MIN_SATELITES;

    const gpsOk = qualidade.trustworthy && fixFresco && satelitesOk;

    const volts = extrairVolts(attrs);
    const { sistema, faixa } = classificarEnergia(volts, {
      charge: attrs.charge,
      powerCut: attrs.powerCut,
    });

    const ignicaoReportada = typeof attrs.ignition === 'boolean';

    const temRef =
      typeof options.refLat === 'number' && typeof options.refLng === 'number';
    const distanceM =
      gpsOk && temRef
        ? distanceMeters(
            { lat: posicao.latitude, lng: posicao.longitude },
            { lat: options.refLat!, lng: options.refLng! },
          )
        : null;
    const pertoDaReferencia =
      distanceM === null || distanceM <= DISTANCIA_MAX_M;

    const motivos = this.explicar({
      comunicando,
      qualidadeOk: qualidade.trustworthy,
      motivoQualidade: qualidade.reason,
      fixFresco,
      satellites,
      satelitesOk,
      faixa,
      volts,
      sistema,
      ignicaoReportada,
      distanceM,
      pertoDaReferencia,
    });

    return {
      imei,
      encontradoNoGps: true,
      jaReportou: true,
      comunicando,
      lastUpdate: device.lastUpdate ?? null,
      gps: {
        ok: gpsOk,
        fixTime: fix,
        idadeSegundos,
        satellites,
        latitude: gpsOk ? posicao.latitude : null,
        longitude: gpsOk ? posicao.longitude : null,
        address: gpsOk ? (posicao.address ?? null) : null,
      },
      energia: {
        volts,
        sistema,
        faixa,
        bateriaInterna:
          typeof attrs.batteryLevel === 'number' ? attrs.batteryLevel : null,
      },
      ignicao: {
        reportada: ignicaoReportada,
        ligada: ignicaoReportada ? (attrs.ignition as boolean) : null,
      },
      velocidade: typeof posicao.speed === 'number' ? posicao.speed : null,
      direcao: typeof posicao.course === 'number' ? posicao.course : null,
      distanceM,
      // `sem-leitura` passa: o equipamento confirma alimentação externa, só não
      // mede tensão. Exigir volts reprovaria o parque gt06 inteiro sem defeito.
      checkOk:
        comunicando &&
        gpsOk &&
        (faixa === 'ok' || faixa === 'sem-leitura') &&
        ignicaoReportada &&
        pertoDaReferencia,
      motivos,
      indisponivel: false,
    };
  }

  /**
   * `status` do Traccar às vezes fica preso em 'unknown' logo após o device ser
   * criado; por isso o `lastUpdate` recente também vale como comunicando.
   */
  private estaComunicando(status: string, lastUpdate: string | null): boolean {
    if (status === 'online') return true;
    if (!lastUpdate) return false;
    const t = Date.parse(lastUpdate);
    return Number.isFinite(t) && Date.now() - t <= COMUNICANDO_MS;
  }

  private explicar(d: {
    comunicando: boolean;
    qualidadeOk: boolean;
    motivoQualidade?: string;
    fixFresco: boolean;
    satellites: number | null;
    satelitesOk: boolean;
    faixa: FaixaEnergia;
    volts: number | null;
    sistema: '12V' | '24V' | null;
    ignicaoReportada: boolean;
    distanceM: number | null;
    pertoDaReferencia: boolean;
  }): string[] {
    const motivos: string[] = [];

    if (!d.comunicando) {
      motivos.push(
        'o chip está fora do ar — sem sinal de celular ou desligado',
      );
    }

    if (!d.qualidadeOk) {
      if (
        d.motivoQualidade === 'approximate' ||
        d.motivoQualidade === 'bad-accuracy'
      ) {
        motivos.push(
          'posição veio por antena de celular, não por GPS — leve o veículo pra céu aberto',
        );
      } else if (
        d.motivoQualidade === 'null-island' ||
        d.motivoQualidade === 'invalid'
      ) {
        motivos.push('GPS sem sinal válido — confira a antena');
      } else {
        motivos.push('posição não confiável — confira a instalação da antena');
      }
    } else if (!d.fixFresco) {
      motivos.push(
        'a última posição de GPS está velha — aguarde o rastreador atualizar',
      );
    } else if (!d.satelitesOk) {
      motivos.push(
        `só ${d.satellites} satélite(s) — a antena de GPS está encoberta`,
      );
    }

    if (d.faixa === 'cortada') {
      motivos.push(
        'o rastreador está sem alimentação do veículo — confira o fio de força',
      );
    } else if (d.faixa === 'ausente') {
      motivos.push(
        'o rastreador não informa nada sobre a alimentação — confira o fio de força',
      );
    } else if (d.faixa === 'baixa') {
      motivos.push(
        `voltagem baixa (${d.volts} V num sistema ${d.sistema}) — bateria fraca ou mau contato`,
      );
    } else if (d.faixa === 'alta') {
      motivos.push(
        `voltagem alta demais (${d.volts} V num sistema ${d.sistema}) — confira o ponto de alimentação`,
      );
    }

    if (!d.ignicaoReportada) {
      motivos.push(
        'o rastreador não informa a ignição — o fio de ignição não foi ligado',
      );
    }

    if (!d.pertoDaReferencia && d.distanceM !== null) {
      motivos.push(
        `o rastreador está a ${this.formatarDistancia(d.distanceM)} de você — confira se é o equipamento certo`,
      );
    }

    return motivos;
  }

  private formatarDistancia(m: number): string {
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
  }

  private vazio(imei: string): DeviceHealth {
    return {
      imei,
      encontradoNoGps: false,
      jaReportou: false,
      comunicando: false,
      lastUpdate: null,
      gps: {
        ok: false,
        fixTime: null,
        idadeSegundos: null,
        satellites: null,
        latitude: null,
        longitude: null,
        address: null,
      },
      energia: {
        volts: null,
        sistema: null,
        faixa: 'ausente',
        bateriaInterna: null,
      },
      ignicao: { reportada: false, ligada: null },
      velocidade: null,
      direcao: null,
      distanceM: null,
      checkOk: false,
      motivos: [],
      indisponivel: false,
    };
  }
}
