import { BadRequestException } from '@nestjs/common';

/**
 * Histórico da TAG para o painel e para o PDF.
 *
 * A TAG não tem GPS próprio, ignição nem hodômetro: ela é vista quando um
 * aparelho com Find My passa por perto. Por isso este relatório só conta o que
 * os avistamentos sustentam (quando, onde, com que precisão) e NUNCA devolve
 * distância, velocidade ou ignição — somar as retas entre avistamentos não é o
 * que o veículo rodou. Ver `scripts/diagnostics/tag-historico-honesto.js`.
 */
export type TipoRelatorioTag = 'basico' | 'avancado' | 'consolidado';

const TIPOS: TipoRelatorioTag[] = ['basico', 'avancado', 'consolidado'];
const DIA_MS = 24 * 3600_000;
const BRASILIA_OFFSET_MS = 3 * 3600_000;
/** Lista avistamento a avistamento pesa: acima disso vai o Consolidado. */
const MAX_DIAS_LISTA = 30;
/** Avistamentos seguidos a até esta distância do primeiro viram uma linha só. */
const RAIO_MESMO_LUGAR_M = 100;

export interface AvistamentoTag {
  seenAt: Date;
  receivedAt: Date;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  source: string;
}

export interface LinhaTag {
  /** Primeira vez que foi vista neste lugar (ISO). */
  time: string;
  /** Última vez que foi vista neste lugar (ISO); igual a `time` se foi uma só. */
  untilTime: string;
  count: number;
  lat: number;
  lng: number;
  accuracyM: number | null;
  // só no avançado
  source?: string;
  /** Minutos entre a TAG ser vista e nós ficarmos sabendo (do último avistamento do grupo). */
  delayMin?: number;
}

export interface DiaTag {
  date: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  /** Onde foi vista por último naquele dia. */
  lat: number;
  lng: number;
}

export interface RelatorioDaTag {
  totals: {
    sightings: number;
    places: number;
    days: number;
    firstSeen: string | null;
    lastSeen: string | null;
  };
  rows: LinhaTag[];
  days: DiaTag[];
}

export function validarPeriodoTag(
  from: string,
  to: string,
  tipo: string,
  maxDias: number,
  agora: number = Date.now(),
): void {
  if (!TIPOS.includes(tipo as TipoRelatorioTag)) {
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
  const limite = tipo === 'consolidado' ? maxDias : MAX_DIAS_LISTA;
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

function diaBrasilia(d: Date): string {
  return new Date(d.getTime() - BRASILIA_OFFSET_MS).toISOString().slice(0, 10);
}

function coordenadaValida(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  // 0,0 é o "sem posição" que a rede devolve quando não sabe onde está.
  return !(lat === 0 && lng === 0);
}

export function buildTagHistoryReport(
  avistamentos: AvistamentoTag[],
  tipo: TipoRelatorioTag,
): RelatorioDaTag {
  const ok = avistamentos
    .filter((a) => coordenadaValida(a.latitude, a.longitude))
    .sort((a, b) => a.seenAt.getTime() - b.seenAt.getTime());

  const dias = new Map<string, DiaTag>();
  for (const a of ok) {
    const data = diaBrasilia(a.seenAt);
    const atual = dias.get(data);
    if (!atual) {
      dias.set(data, {
        date: data,
        count: 1,
        firstSeen: a.seenAt.toISOString(),
        lastSeen: a.seenAt.toISOString(),
        lat: a.latitude,
        lng: a.longitude,
      });
    } else {
      atual.count += 1;
      atual.lastSeen = a.seenAt.toISOString();
      atual.lat = a.latitude;
      atual.lng = a.longitude;
    }
  }

  const grupos: { ancora: AvistamentoTag; ultimo: AvistamentoTag; count: number }[] = [];
  for (const a of ok) {
    const g = grupos[grupos.length - 1];
    if (
      g &&
      metros(
        { lat: g.ancora.latitude, lng: g.ancora.longitude },
        { lat: a.latitude, lng: a.longitude },
      ) <= RAIO_MESMO_LUGAR_M
    ) {
      g.ultimo = a;
      g.count += 1;
    } else {
      grupos.push({ ancora: a, ultimo: a, count: 1 });
    }
  }

  const totals = {
    sightings: ok.length,
    places: grupos.length,
    days: dias.size,
    firstSeen: ok.length ? ok[0].seenAt.toISOString() : null,
    lastSeen: ok.length ? ok[ok.length - 1].seenAt.toISOString() : null,
  };

  if (tipo === 'consolidado') {
    return { totals, rows: [], days: [...dias.values()] };
  }

  const rows: LinhaTag[] = grupos.map((g) => {
    const linha: LinhaTag = {
      time: g.ancora.seenAt.toISOString(),
      untilTime: g.ultimo.seenAt.toISOString(),
      count: g.count,
      lat: g.ancora.latitude,
      lng: g.ancora.longitude,
      accuracyM: g.ancora.accuracyM,
    };
    if (tipo === 'avancado') {
      linha.source = g.ultimo.source;
      linha.delayMin = Math.max(
        0,
        Math.round((g.ultimo.receivedAt.getTime() - g.ultimo.seenAt.getTime()) / 60000),
      );
    }
    return linha;
  });
  return { totals, rows, days: [] };
}
