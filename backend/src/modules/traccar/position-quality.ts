import type { TraccarPosition } from './traccar.service';

/**
 * Decide se uma posição pode ser tratada como "onde o veículo está".
 *
 * Existe porque o rastreador, sem sinal de GPS (garagem, antena coberta,
 * mochila fechada), continua reportando — mas por triangulação de torre de
 * celular (LBS), com erro que chega a quilômetros. O Traccar marca essas
 * posições; até 2026-08-10 nós ignorávamos a marcação e elas apareciam no mapa
 * como localização exata. Num roubo, isso manda a equipe pro lugar errado.
 *
 * Regra do projeto: posição reprovada aqui NUNCA vai pro mapa, pro app do
 * associado nem pro histórico de rota. Ver docs/PLANO-PRODUCAO-ZERO-ERRO.md P0.1.
 */

/** Acima disso o próprio rastreador está dizendo que não sabe onde está. */
export const MAX_ACCURACY_M = 1000;

/** Tolerância pra fix no futuro (relógio do rastreador adiantado). */
export const MAX_CLOCK_SKEW_MS = 60 * 60 * 1000;

export type PositionRejectReason =
  | 'invalid'
  | 'outdated'
  | 'approximate'
  | 'null-island'
  | 'out-of-range'
  | 'bad-accuracy'
  | 'future-fix';

export interface PositionQuality {
  /** Posição confiável o bastante pra ser exibida como localização real. */
  trustworthy: boolean;
  reason?: PositionRejectReason;
}

type PositionLike = Pick<
  TraccarPosition,
  'latitude' | 'longitude' | 'valid' | 'outdated' | 'accuracy' | 'attributes'
> & { fixTime?: string; deviceTime?: string };

/**
 * `now` é injetável só pros testes — em produção sempre o relógio real.
 */
export function assessPosition(
  position: PositionLike,
  now: number = Date.now(),
): PositionQuality {
  // O Traccar já resolveu: fix inválido.
  if (position.valid === false) return { trustworthy: false, reason: 'invalid' };

  // Posição antiga reemitida (buffer do rastreador ou replay do WebSocket).
  if (position.outdated === true) {
    return { trustworthy: false, reason: 'outdated' };
  }

  // LBS explícito: alguns protocolos marcam no atributo em vez do flag.
  const attrs = (position.attributes ?? {}) as Record<string, unknown>;
  if (attrs.approximate === true || attrs.lbs === true) {
    return { trustworthy: false, reason: 'approximate' };
  }

  const { latitude: lat, longitude: lng } = position;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { trustworthy: false, reason: 'out-of-range' };
  }
  // 0,0 no Golfo da Guiné = rastreador sem fix mandando zero.
  if (lat === 0 && lng === 0) {
    return { trustworthy: false, reason: 'null-island' };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { trustworthy: false, reason: 'out-of-range' };
  }

  if (
    typeof position.accuracy === 'number' &&
    position.accuracy > MAX_ACCURACY_M
  ) {
    return { trustworthy: false, reason: 'bad-accuracy' };
  }

  // Fix muito no futuro = relógio do rastreador zoado; a hora não serve pra
  // decidir "posição fresca" e o ponto vira ruído no replay.
  const fix = position.fixTime ?? position.deviceTime;
  if (fix) {
    const t = Date.parse(fix);
    if (Number.isFinite(t) && t - now > MAX_CLOCK_SKEW_MS) {
      return { trustworthy: false, reason: 'future-fix' };
    }
  }

  return { trustworthy: true };
}

export function isTrustworthyPosition(
  position: PositionLike,
  now?: number,
): boolean {
  return assessPosition(position, now).trustworthy;
}

/** Distância em metros entre duas coordenadas (Haversine). */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}
