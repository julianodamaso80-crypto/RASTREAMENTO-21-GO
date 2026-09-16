/**
 * Portão de localização da TAG — spec 2026-09-16 §7.
 *
 * O vínculo TAG → associado vem da RedeVeiculos e do SGA; este módulo só decide
 * se a POSIÇÃO confirma esse vínculo. A régua é a do rastreador do mesmo carro:
 * medido em 16/09/2026, a TAG da RMX4D35 ficou a 2–17 m do rastreador dela.
 *
 * O ponto da TAG guardado pela RedeVeiculos NÃO serve de prova: ela não
 * acompanha estas TAGs (o da RMX4D35 estava parado em 05/08, na oficina).
 */

/** Diferença máxima de tempo para comparar um avistamento com o rastreador. */
export const DT_COMPARAVEL_MS = 10 * 60_000;
/** Tolerância somada à precisão do avistamento. */
export const FOLGA_RASTREADOR_M = 300;
/** Precisão assumida quando a rede não informa. */
export const PRECISAO_PADRAO_M = 50;
/** Acima disto, no mesmo momento, a TAG não está no carro. */
export const CONTRADICAO_M = 2000;
/** TAG livre "parada": todos os pontos dentro deste raio entre si. */
export const RAIO_PARADA_M = 1000;

export interface Avistamento {
  lat: number;
  lng: number;
  accuracyM: number | null;
  seenAt: Date;
}

export interface ReferenciaRastreador {
  lat: number;
  lng: number;
  em: Date;
  fonte: 'RDV_RASTREADOR' | 'TRACCAR';
}

export type VereditoVinculada = 'CONFIRMADA' | 'DIVERGENTE' | 'AGUARDANDO_PROVA';
export type VereditoLivre = 'ESTOQUE' | 'LIVRE_EM_MOVIMENTO';

export interface Prova {
  fonte: ReferenciaRastreador['fonte'];
  referenciaEm: string;
  avistamentoEm: string;
  dtSegundos: number;
  distanciaM: number;
  toleranciaM: number;
  resultado: 'BATE' | 'CONTRADIZ' | 'INCONCLUSIVO';
}

export function distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function avaliarTagVinculada(
  avistamentos: Avistamento[],
  referencias: ReferenciaRastreador[],
): { veredito: VereditoVinculada; provas: Prova[] } {
  const provas: Prova[] = [];

  for (const ref of referencias) {
    let melhor: Avistamento | null = null;
    let melhorDt = Infinity;
    for (const a of avistamentos) {
      const dt = Math.abs(a.seenAt.getTime() - ref.em.getTime());
      if (dt < melhorDt) {
        melhor = a;
        melhorDt = dt;
      }
    }
    if (!melhor || melhorDt > DT_COMPARAVEL_MS) continue;

    const distanciaM = distanciaMetros(melhor.lat, melhor.lng, ref.lat, ref.lng);
    const toleranciaM = (melhor.accuracyM ?? PRECISAO_PADRAO_M) + FOLGA_RASTREADOR_M;
    provas.push({
      fonte: ref.fonte,
      referenciaEm: ref.em.toISOString(),
      avistamentoEm: melhor.seenAt.toISOString(),
      dtSegundos: Math.round(melhorDt / 1000),
      distanciaM: Math.round(distanciaM),
      toleranciaM,
      resultado:
        distanciaM > CONTRADICAO_M ? 'CONTRADIZ' : distanciaM <= toleranciaM ? 'BATE' : 'INCONCLUSIVO',
    });
  }

  const veredito: VereditoVinculada = provas.some((p) => p.resultado === 'CONTRADIZ')
    ? 'DIVERGENTE'
    : provas.some((p) => p.resultado === 'BATE')
      ? 'CONFIRMADA'
      : 'AGUARDANDO_PROVA';
  return { veredito, provas };
}

export function avaliarTagLivre(avistamentos: Avistamento[]): {
  veredito: VereditoLivre;
  maiorDistanciaM: number;
} {
  let maior = 0;
  for (let i = 0; i < avistamentos.length; i++) {
    for (let j = i + 1; j < avistamentos.length; j++) {
      const d = distanciaMetros(
        avistamentos[i].lat,
        avistamentos[i].lng,
        avistamentos[j].lat,
        avistamentos[j].lng,
      );
      if (d > maior) maior = d;
    }
  }
  return {
    veredito: maior > RAIO_PARADA_M ? 'LIVRE_EM_MOVIMENTO' : 'ESTOQUE',
    maiorDistanciaM: Math.round(maior),
  };
}
