export interface PontoDaViagem {
  time: string;
  lat: number;
  lng: number;
  speed: number;
  ignition: boolean | null;
}

export interface ViagemDoDia {
  startTime: string;
  endTime: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  distanceKm: number;
  durationMin: number;
  maxSpeed: number;
  avgSpeed: number;
  stopAfterMin: number | null;
  startAddress?: string | null;
  endAddress?: string | null;
  path: PontoDaViagem[];
}

export interface JornadaDoDia {
  date: string;
  trips: ViagemDoDia[];
}

/** Dia civil de Brasília (UTC−3) no formato AAAA-MM-DD. */
export function diaDeBrasilia(instante: number): string {
  return new Date(instante - 3 * 3600_000).toISOString().slice(0, 10);
}

export function horaLocal(iso: string, comSegundos = false): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: comSegundos ? '2-digit' : undefined,
    timeZone: 'America/Sao_Paulo',
  });
}

export function kmLegivel(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

export function duracaoLegivel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** CSV da viagem (ponto a ponto), com BOM para o Excel abrir os acentos. */
export function viagensParaCsv(v: ViagemDoDia): string {
  const linhas = v.path.map((p) =>
    [
      new Date(p.time).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      p.lat,
      p.lng,
      p.speed,
      p.ignition === null ? '' : p.ignition ? 'Ligada' : 'Desligada',
    ].join(';'),
  );
  return '﻿' + ['Data/Hora;Latitude;Longitude;Velocidade (km/h);Ignição', ...linhas].join('\n');
}

export type TipoRelatorio = 'basico' | 'avancado' | 'consolidado';

export interface LinhaRelatorio {
  time: string;
  lat: number;
  lng: number;
  speed: number;
  ignition: boolean | null;
  event: string | null;
  distanceM: number | null;
  address: string | null;
  gprs?: string;
  gps?: string;
  direction?: string;
}

export interface DiaRelatorio {
  date: string;
  maxSpeed: number;
  lat: number;
  lng: number;
  address: string | null;
}

export interface RelatorioHistorico {
  plate: string;
  from: string;
  to: string;
  type: TipoRelatorio;
  totals: { distanceKm: number; ignitionOnMin: number; ignitionOffMin: number };
  rows: LinhaRelatorio[];
  days: DiaRelatorio[];
}

/** Valor de <input type="datetime-local"> (hora do navegador) a partir de um instante. */
export function paraCampoLocal(instante: number): string {
  const d = new Date(instante);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function dataHoraLocal(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function distanciaDaLinha(m: number | null, kmh: number): string {
  if (m === null) return '—';
  if (m === 0 && kmh === 0) return 'Parado';
  return m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} km` : `${m} m`;
}

/** CSV do relatório (Excel abre com acento por causa do BOM). */
export function relatorioParaCsv(r: RelatorioHistorico): string {
  if (r.type === 'consolidado') {
    const linhas = r.days.map((d) =>
      [d.date.split('-').reverse().join('/'), d.maxSpeed, `"${d.address ?? ''}"`].join(';'),
    );
    return '\ufeff' + ['Data;Velocidade máxima (km/h);Endereço', ...linhas].join('\n');
  }
  const avancado = r.type === 'avancado';
  const cab = ['Data/Hora', ...(avancado ? ['GPRS', 'GPS'] : []), 'Latitude', 'Longitude', 'Endereço', 'Km/h', 'Ignição', 'Evento', 'Distância', ...(avancado ? ['Direção'] : [])];
  const linhas = r.rows.map((l) =>
    [
      dataHoraLocal(l.time),
      ...(avancado ? [l.gprs ? dataHoraLocal(l.gprs) : '', l.gps ? dataHoraLocal(l.gps) : ''] : []),
      l.lat,
      l.lng,
      `"${l.address ?? ''}"`,
      l.speed,
      l.ignition === null ? '' : l.ignition ? 'Ligado' : 'Desligado',
      l.event ?? '',
      distanciaDaLinha(l.distanceM, l.speed),
      ...(avancado ? [l.direction ?? ''] : []),
    ].join(';'),
  );
  return '\ufeff' + [cab.join(';'), ...linhas].join('\n');
}
