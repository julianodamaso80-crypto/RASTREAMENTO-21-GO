/**
 * Geometria de rota — funções puras, sem banco nem rede.
 *
 * Agrupamento de pendências próximas em bolsões e ordenação da rota pelo
 * vizinho-mais-próximo. Distâncias em quilômetros pela fórmula de Haversine,
 * suficiente pra escala urbana (erro < 0,5% no RJ).
 */

export interface GeoPoint {
  id: string;
  lat: number;
  lng: number;
}

const RAIO_TERRA_KM = 6371;

function rad(graus: number): number {
  return (graus * Math.PI) / 180;
}

/** Distância em km entre dois pontos (Haversine). */
export function distanciaKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.sqrt(s));
}

export interface Cluster<T extends GeoPoint> {
  pontos: T[];
  centro: { lat: number; lng: number };
  /** Distância do ponto mais distante ao centro, em km. */
  raioKm: number;
}

const KM_POR_GRAU_LAT = 111.32;

/**
 * Agrupa pontos numa grade geográfica de `celulaKm` de lado.
 *
 * Por que grade e não "junta quem está a menos de X km" (single-linkage): numa
 * cidade densa aquele método encadeia — A perto de B, B perto de C — e tudo
 * vira um bolsão só. Medido em produção 2026-07-23: gerou um bolsão de 2.595
 * instalações com **42 km de raio**, inútil pra roteirizar. A grade limita o
 * raio por construção (no máximo meia diagonal da célula) e dá bolsões do
 * tamanho que um técnico cobre num dia.
 *
 * O(n) — e o raio de cada bolsão é previsível.
 */
export function agrupar<T extends GeoPoint>(
  pontos: T[],
  celulaKm = 4,
): Cluster<T>[] {
  if (!pontos.length) return [];

  const deltaLat = celulaKm / KM_POR_GRAU_LAT;
  // 1 grau de longitude encolhe conforme sai do equador.
  const latMedia = pontos.reduce((s, p) => s + p.lat, 0) / pontos.length;
  const kmPorGrauLng = KM_POR_GRAU_LAT * Math.cos(rad(latMedia));
  const deltaLng = celulaKm / Math.max(kmPorGrauLng, 1);

  const celulas = new Map<string, T[]>();
  for (const p of pontos) {
    const chave = `${Math.floor(p.lat / deltaLat)}:${Math.floor(p.lng / deltaLng)}`;
    const atual = celulas.get(chave);
    if (atual) atual.push(p);
    else celulas.set(chave, [p]);
  }

  const clusters: Cluster<T>[] = [];
  for (const membros of celulas.values()) {
    const centro = {
      lat: membros.reduce((s, p) => s + p.lat, 0) / membros.length,
      lng: membros.reduce((s, p) => s + p.lng, 0) / membros.length,
    };
    const raioKm = membros.reduce(
      (max, p) => Math.max(max, distanciaKm({ id: '', ...centro }, p)),
      0,
    );
    clusters.push({ pontos: membros, centro, raioKm });
  }

  // Maiores bolsões primeiro — é onde o técnico rende mais.
  return clusters.sort((a, b) => b.pontos.length - a.pontos.length);
}

/**
 * Ordena a visita pelo vizinho-mais-próximo a partir de `origem` (ou do primeiro
 * ponto, se não houver origem). Heurística boa pra bolsão denso e barata de rodar.
 * Retorna os pontos na ordem de visita.
 */
export function ordenarRota<T extends GeoPoint>(
  pontos: T[],
  origem?: { lat: number; lng: number },
): T[] {
  if (pontos.length <= 2) return [...pontos];

  const restantes = [...pontos];
  const rota: T[] = [];

  // Sem origem explícita, começa pelo ponto mais ao sudoeste — dá uma ordem
  // estável e evita começar no meio do bolsão.
  let atual: GeoPoint = origem
    ? { id: '', lat: origem.lat, lng: origem.lng }
    : restantes.reduce((a, b) => (a.lat + a.lng <= b.lat + b.lng ? a : b));

  if (!origem) {
    const i = restantes.indexOf(atual as T);
    rota.push(restantes.splice(i, 1)[0]);
  }

  while (restantes.length) {
    let melhor = 0;
    let melhorDist = Infinity;
    for (let i = 0; i < restantes.length; i++) {
      const d = distanciaKm(atual, restantes[i]);
      if (d < melhorDist) {
        melhorDist = d;
        melhor = i;
      }
    }
    atual = restantes[melhor];
    rota.push(restantes.splice(melhor, 1)[0]);
  }

  return rota;
}
