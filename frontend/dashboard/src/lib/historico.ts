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
