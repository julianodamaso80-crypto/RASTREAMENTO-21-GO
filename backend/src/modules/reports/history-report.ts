import { BadRequestException } from '@nestjs/common';
import type { TraccarPosition } from '../traccar/traccar.service';
import { assessPosition } from '../traccar/position-quality';

export type TipoRelatorio = 'basico' | 'avancado' | 'consolidado';

const TIPOS: TipoRelatorio[] = ['basico', 'avancado', 'consolidado'];
const DIA_MS = 24 * 3600_000;
/** Lista posição a posição pesa: acima disso a Rede manda por relatório. */
const MAX_DIAS_POSICOES = 7;
/** Intervalo sem posição maior que isso não conta como ignição ligada/desligada. */
const LACUNA_MAX_MS = 60 * 60_000;
const BRASILIA_OFFSET_MS = 3 * 3600_000;
const NOS_PARA_KMH = 1.852;

export interface LinhaDoRelatorio {
  time: string;
  lat: number;
  lng: number;
  speed: number; // km/h
  ignition: boolean | null;
  event: string | null;
  /** Metros desde a linha anterior; null na primeira. */
  distanceM: number | null;
  // só no avançado
  gprs?: string;
  gps?: string;
  direction?: string;
}

export interface DiaConsolidado {
  date: string;
  maxSpeed: number;
  lat: number;
  lng: number;
}

export interface RelatorioDeHistorico {
  totals: { distanceKm: number; ignitionOnMin: number; ignitionOffMin: number };
  rows: LinhaDoRelatorio[];
  days: DiaConsolidado[];
}

const CARDEAIS = [
  'Norte',
  'Nordeste',
  'Leste',
  'Sudeste',
  'Sul',
  'Sudoeste',
  'Oeste',
  'Noroeste',
];

export function direcaoCardeal(graus: number): string {
  const g = ((graus % 360) + 360) % 360;
  return CARDEAIS[Math.round(g / 45) % 8];
}

export function validarPeriodo(
  from: string,
  to: string,
  tipo: string,
  maxDias: number,
  agora: number = Date.now(),
): void {
  if (!TIPOS.includes(tipo as TipoRelatorio)) {
    throw new BadRequestException('Tipo de relatório inválido');
  }
  const ini = Date.parse(from);
  const fim = Date.parse(to);
  if (!Number.isFinite(ini) || !Number.isFinite(fim)) {
    throw new BadRequestException('Período inválido');
  }
  if (ini > fim) {
    throw new BadRequestException(
      'A Data/Hora Inicial não pode ser maior que a Data/Hora Final',
    );
  }
  if (ini < agora - maxDias * DIA_MS) {
    throw new BadRequestException(`O histórico guarda os últimos ${maxDias} dias`);
  }
  const limite = tipo === 'consolidado' ? maxDias : MAX_DIAS_POSICOES;
  if (fim - ini > limite * DIA_MS) {
    throw new BadRequestException(
      tipo === 'consolidado'
        ? `O período não pode ser maior que ${limite} dias`
        : `Neste relatório o período não pode ser maior que ${limite} dias. Para períodos maiores use o Consolidado.`,
    );
  }
}

function metros(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function diaBrasilia(iso: string): string {
  return new Date(Date.parse(iso) - BRASILIA_OFFSET_MS).toISOString().slice(0, 10);
}

export function buildHistoryReport(
  positions: TraccarPosition[],
  tipo: TipoRelatorio,
): RelatorioDeHistorico {
  const ok = positions
    .filter((p) => assessPosition(p).trustworthy)
    .sort((a, b) => Date.parse(a.deviceTime) - Date.parse(b.deviceTime));

  // Totais sobre todas as posições confiáveis, antes de tirar repetições.
  let distancia = 0;
  let ligadaMs = 0;
  let desligadaMs = 0;
  for (let i = 1; i < ok.length; i++) {
    const a = ok[i - 1];
    const b = ok[i];
    distancia += metros(
      { lat: a.latitude, lng: a.longitude },
      { lat: b.latitude, lng: b.longitude },
    );
    const dt = Date.parse(b.deviceTime) - Date.parse(a.deviceTime);
    if (dt > 0 && dt <= LACUNA_MAX_MS && typeof a.attributes?.ignition === 'boolean') {
      if (a.attributes.ignition) ligadaMs += dt;
      else desligadaMs += dt;
    }
  }
  const totals = {
    distanceKm: Math.round(distancia / 10) / 100,
    ignitionOnMin: Math.round(ligadaMs / 60000),
    ignitionOffMin: Math.round(desligadaMs / 60000),
  };

  if (tipo === 'consolidado') {
    const porDia = new Map<string, DiaConsolidado>();
    for (const p of ok) {
      const kmh = Math.round(p.speed * NOS_PARA_KMH);
      const data = diaBrasilia(p.deviceTime);
      const atual = porDia.get(data);
      if (!atual || kmh > atual.maxSpeed) {
        porDia.set(data, { date: data, maxSpeed: kmh, lat: p.latitude, lng: p.longitude });
      }
    }
    return { totals, rows: [], days: [...porDia.values()] };
  }

  const rows: LinhaDoRelatorio[] = [];
  let anterior: TraccarPosition | null = null;
  for (const p of ok) {
    const kmh = Math.round(p.speed * NOS_PARA_KMH);
    const ign = typeof p.attributes?.ignition === 'boolean' ? p.attributes.ignition : null;
    const ultima = rows[rows.length - 1];
    const repetida =
      ultima &&
      kmh === 0 &&
      ultima.speed === 0 &&
      ultima.ignition === ign &&
      ultima.lat === p.latitude &&
      ultima.lng === p.longitude;
    if (repetida) continue;

    const linha: LinhaDoRelatorio = {
      time: p.deviceTime,
      lat: p.latitude,
      lng: p.longitude,
      speed: kmh,
      ignition: ign,
      event: p.attributes?.alarm ?? null,
      distanceM: anterior
        ? Math.round(
            metros(
              { lat: anterior.latitude, lng: anterior.longitude },
              { lat: p.latitude, lng: p.longitude },
            ),
          )
        : null,
    };
    if (tipo === 'avancado') {
      linha.gprs = p.serverTime;
      linha.gps = p.fixTime;
      linha.direction = direcaoCardeal(p.course);
    }
    rows.push(linha);
    anterior = p;
  }
  return { totals, rows, days: [] };
}
