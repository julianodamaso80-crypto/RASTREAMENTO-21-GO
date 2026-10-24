import type { TipoRelatorio } from '@/lib/historico';

/**
 * Histórico da TAG. A TAG só diz onde e quando foi vista e com que precisão:
 * não há velocidade, ignição nem distância aqui, de propósito.
 */
export interface LinhaDaTag {
  time: string;
  untilTime: string;
  count: number;
  lat: number;
  lng: number;
  accuracyM: number | null;
  address: string | null;
  source?: string;
  delayMin?: number;
}

export interface DiaDaTag {
  date: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  lat: number;
  lng: number;
  address: string | null;
}

export interface RelatorioDaTag {
  plate: string;
  serial: string;
  from: string;
  to: string;
  type: TipoRelatorio;
  totals: {
    sightings: number;
    places: number;
    days: number;
    firstSeen: string | null;
    lastSeen: string | null;
  };
  rows: LinhaDaTag[];
  days: DiaDaTag[];
}

function csvTexto(v: string | null | undefined): string {
  return `"${(v ?? '').replace(/"/g, '""')}"`;
}

function data(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** CSV do histórico da TAG (Excel abre com acento por causa do BOM). */
export function relatorioTagParaCsv(r: RelatorioDaTag): string {
  if (r.type === 'consolidado') {
    const linhas = r.days.map((d) =>
      [
        d.date.split('-').reverse().join('/'),
        d.count,
        data(d.firstSeen),
        data(d.lastSeen),
        d.lat,
        d.lng,
        csvTexto(d.address),
      ].join(';'),
    );
    return (
      '\ufeff' +
      ['Data;Avistamentos;Primeiro avistamento;Último avistamento;Latitude;Longitude;Endereço', ...linhas].join(
        '\n',
      )
    );
  }
  const avancado = r.type === 'avancado';
  const cab = [
    'Visto em',
    'Visto até',
    'Avistamentos',
    'Latitude',
    'Longitude',
    'Endereço',
    'Precisão (m)',
    ...(avancado ? ['Atraso da informação (min)', 'Fonte'] : []),
  ];
  const linhas = r.rows.map((l) =>
    [
      data(l.time),
      data(l.untilTime),
      l.count,
      l.lat,
      l.lng,
      csvTexto(l.address),
      l.accuracyM ?? '',
      ...(avancado ? [l.delayMin ?? '', l.source ?? ''] : []),
    ].join(';'),
  );
  return '\ufeff' + [cab.join(';'), ...linhas].join('\n');
}
