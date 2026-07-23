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

/**
 * Agrupa pontos por proximidade (single-linkage): dois pontos ficam no mesmo
 * bolsão se estão a menos de `limiteKm` um do outro, transitivamente. Um ponto
 * isolado vira um bolsão de tamanho 1.
 *
 * O(n²) — ok pros ~5 mil pontos de um tenant rodando fora do request quente.
 */
export function agrupar<T extends GeoPoint>(
  pontos: T[],
  limiteKm = 2,
): Cluster<T>[] {
  const n = pontos.length;
  const grupo = new Array<number>(n).fill(-1);
  let atual = 0;

  for (let i = 0; i < n; i++) {
    if (grupo[i] !== -1) continue;
    // BFS ligando todos os pontos alcançáveis dentro do limite.
    grupo[i] = atual;
    const fila = [i];
    while (fila.length) {
      const p = fila.pop()!;
      for (let j = 0; j < n; j++) {
        if (grupo[j] === -1 && distanciaKm(pontos[p], pontos[j]) <= limiteKm) {
          grupo[j] = atual;
          fila.push(j);
        }
      }
    }
    atual++;
  }

  const clusters: Cluster<T>[] = [];
  for (let g = 0; g < atual; g++) {
    const membros = pontos.filter((_, i) => grupo[i] === g);
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
