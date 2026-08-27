/**
 * Tradução das linhas de TAG da plataforma de origem (RedeVeiculos) para o
 * espelho `rdv_tags`.
 *
 * Lógica pura, sem banco e sem rede: é o que permite provar por teste as duas
 * armadilhas do formato de lá — coordenada ausente que vira (0,0) e hora de
 * Brasília escrita sem fuso.
 */

/** A origem escreve data/hora em horário de Brasília, sem fuso no texto. */
const TZ_OFFSET_HOURS = -3;

export type TagRdvBruta = {
  placa?: string | null;
  imei?: string | null;
  latLng?: string | null;
  visto?: string | null;
  chassi?: string | null;
  idAtivo?: string | null;
};

export type LinhaEspelho = {
  tagIdentifier: string;
  plate: string;
  chassi: string | null;
  tagModel: string | null;
  lastLat: number | null;
  lastLng: number | null;
  seenAt: Date | null;
  sourceAssetId: string | null;
};

/**
 * `"-22.938804|-43.560138"` → `{lat, lng}`.
 *
 * (0,0) é descartado de propósito: é o que a origem manda quando não tem
 * posição, e no mapa isso cairia no golfo da Guiné parecendo posição real.
 */
export function parsePosicao(
  bruto: string | null | undefined,
): { lat: number; lng: number } | null {
  if (!bruto || typeof bruto !== 'string') return null;

  const [a, b] = bruto.split('|');
  const lat = Number(a);
  const lng = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return { lat, lng };
}

/** `"2026-08-27 10:50:34"` (hora de Brasília) → `Date` em UTC. */
export function parseVistoEm(bruto: string | null | undefined): Date | null {
  if (!bruto || typeof bruto !== 'string') return null;
  if (bruto.startsWith('0000-')) return null;

  const sinal = TZ_OFFSET_HOURS <= 0 ? '-' : '+';
  const horas = String(Math.abs(TZ_OFFSET_HOURS)).padStart(2, '0');
  const data = new Date(`${bruto.trim().replace(' ', 'T')}${sinal}${horas}:00`);
  return Number.isNaN(data.getTime()) ? null : data;
}

/**
 * @param modeloPorPlaca placas agrupadas por modelo de TAG (REDETAG, KTAG…),
 * vindas da exportação de ativos. O endpoint de rastreamento não diz o modelo.
 */
export function mapearTagRdv(
  bruta: TagRdvBruta,
  modeloPorPlaca: Record<string, string[]>,
): LinhaEspelho | null {
  const tagIdentifier = (bruta.imei ?? '').trim();
  const plate = (bruta.placa ?? '').trim().toUpperCase();
  if (!tagIdentifier || !plate) return null;

  const pos = parsePosicao(bruta.latLng);
  const modelo =
    Object.entries(modeloPorPlaca).find(([, placas]) =>
      placas.includes(plate),
    )?.[0] ?? null;

  return {
    tagIdentifier,
    plate,
    chassi: (bruta.chassi ?? '').trim() || null,
    tagModel: modelo,
    lastLat: pos?.lat ?? null,
    lastLng: pos?.lng ?? null,
    seenAt: parseVistoEm(bruta.visto),
    sourceAssetId: (bruta.idAtivo ?? '').trim() || null,
  };
}
