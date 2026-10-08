import { BadRequestException } from '@nestjs/common';
import type { TraccarPosition } from '../traccar/traccar.service';
import { assessPosition } from '../traccar/position-quality';

/** Brasília é UTC−3 o ano todo (sem horário de verão desde 2019). */
const BRASILIA_OFFSET_H = 3;
const PARADA_MS = 5 * 60 * 1000;
/** Sem sinal por mais que isso no meio do movimento = outra viagem. */
const LACUNA_MS = 30 * 60 * 1000;
const NOS_PARA_KMH = 1.852;
const VELOCIDADE_MINIMA_NOS = 2;

export interface JourneyPoint {
  time: string;
  lat: number;
  lng: number;
  speed: number; // km/h
  ignition: boolean | null;
}

export interface JourneyTrip {
  startTime: string;
  endTime: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  distanceKm: number;
  durationMin: number;
  maxSpeed: number; // km/h
  avgSpeed: number; // km/h
  /** Minutos parado até a viagem seguinte do mesmo dia; null na última. */
  stopAfterMin: number | null;
  path: JourneyPoint[];
}

/** Janela UTC do dia civil `YYYY-MM-DD` em Brasília. */
export function diaEmBrasilia(data: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!m) throw new BadRequestException('Data inválida: use AAAA-MM-DD');
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const inicio = Date.UTC(ano, mes - 1, dia, BRASILIA_OFFSET_H);
  const conferido = new Date(inicio - BRASILIA_OFFSET_H * 3600_000);
  if (
    conferido.getUTCFullYear() !== ano ||
    conferido.getUTCMonth() !== mes - 1 ||
    conferido.getUTCDate() !== dia
  ) {
    throw new BadRequestException('Data inválida: use AAAA-MM-DD');
  }
  return {
    from: new Date(inicio).toISOString(),
    to: new Date(inicio + 24 * 3600_000).toISOString(),
  };
}

/** Recusa dia no futuro ou mais antigo que `maxDias` (contado em Brasília). */
export function validarDiaDoHistorico(
  data: string,
  maxDias: number,
  agora: number = Date.now(),
): void {
  const { from } = diaEmBrasilia(data);
  const hoje = Date.parse(diaEmBrasilia(
    new Date(agora - BRASILIA_OFFSET_H * 3600_000).toISOString().slice(0, 10),
  ).from);
  const dias = Math.round((hoje - Date.parse(from)) / (24 * 3600_000));
  if (dias < 0) throw new BadRequestException('Esse dia ainda não aconteceu');
  if (dias > maxDias) {
    throw new BadRequestException(
      `O histórico guarda os últimos ${maxDias} dias`,
    );
  }
}

function haversineKm(a: JourneyPoint, b: JourneyPoint): number {
  const R = 6371;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function fechar(path: JourneyPoint[]): JourneyTrip | null {
  if (path.length < 2) return null;
  const first = path[0];
  const last = path[path.length - 1];
  let distancia = 0;
  for (let i = 1; i < path.length; i++) distancia += haversineKm(path[i - 1], path[i]);
  const velocidades = path.map((p) => p.speed);
  return {
    startTime: first.time,
    endTime: last.time,
    startLat: first.lat,
    startLng: first.lng,
    endLat: last.lat,
    endLng: last.lng,
    distanceKm: Math.round(distancia * 100) / 100,
    durationMin: Math.round(
      (Date.parse(last.time) - Date.parse(first.time)) / 60000,
    ),
    maxSpeed: Math.max(...velocidades),
    avgSpeed: Math.round(
      velocidades.reduce((s, v) => s + v, 0) / velocidades.length,
    ),
    stopAfterMin: null,
    path,
  };
}

/**
 * Viagens de um conjunto de posições, na mesma regra de movimento do
 * ReportsService.getTrips (acima de 2 nós, 5 min de parada encerra), mas
 * guardando o trajeto de cada uma e filtrando pela qualidade da posição.
 */
export function buildJourney(positions: TraccarPosition[]): JourneyTrip[] {
  const confiaveis = positions
    .filter((p) => assessPosition(p).trustworthy)
    .sort((a, b) => Date.parse(a.deviceTime) - Date.parse(b.deviceTime));

  const viagens: JourneyTrip[] = [];
  let atual: JourneyPoint[] = [];
  let ultimoMovimento = 0;

  const encerrar = () => {
    const v = fechar(atual);
    if (v) viagens.push(v);
    atual = [];
  };

  for (const p of confiaveis) {
    const t = Date.parse(p.deviceTime);
    const emMovimento = p.speed > VELOCIDADE_MINIMA_NOS;
    const limite = emMovimento ? LACUNA_MS : PARADA_MS;
    if (atual.length > 0 && t - ultimoMovimento > limite) encerrar();
    if (emMovimento) {
      atual.push({
        time: p.deviceTime,
        lat: p.latitude,
        lng: p.longitude,
        speed: Math.round(p.speed * NOS_PARA_KMH),
        ignition:
          typeof p.attributes?.ignition === 'boolean'
            ? p.attributes.ignition
            : null,
      });
      ultimoMovimento = t;
    }
  }
  encerrar();

  for (let i = 0; i < viagens.length - 1; i++) {
    viagens[i].stopAfterMin = Math.round(
      (Date.parse(viagens[i + 1].startTime) - Date.parse(viagens[i].endTime)) /
        60000,
    );
  }
  return viagens;
}
