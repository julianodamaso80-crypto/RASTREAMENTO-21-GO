import Supercluster from 'supercluster';
import type { StockMapPoint } from '@/types/stock';

// Env de build: o Next embute o valor no bundle. Ausente = um marcador por ponto (o de hoje).
export const CLUSTER_ATIVO = process.env.NEXT_PUBLIC_STOCK_MAP_CLUSTER === 'on';

/** Mesmos parâmetros do mapa principal: a partir do zoom 17 todo ponto aparece sozinho. */
export const CLUSTER_MAX_ZOOM = 16;
const CLUSTER_RADIUS = 60;

type PropsPonto = { id: string };

export interface ClusterVisivel {
  id: number;
  lngLat: [number, number];
  total: number;
}

// Os pontos de cada índice, por id: é daqui que saem os fixos fora do bbox e o
// ponto completo de cada item solto.
const pontosDoIndice = new WeakMap<Supercluster, Map<string, StockMapPoint>>();

export function indexarPontos(pontos: StockMapPoint[]): Supercluster {
  const porId = new Map<string, StockMapPoint>();
  const features: Supercluster.PointFeature<PropsPonto>[] = [];
  for (const p of pontos) {
    if (p.latitude === null || p.longitude === null) continue;
    porId.set(p.id, p);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
      properties: { id: p.id },
    });
  }
  const indice = new Supercluster<PropsPonto>({ radius: CLUSTER_RADIUS, maxZoom: CLUSTER_MAX_ZOOM });
  indice.load(features);
  pontosDoIndice.set(indice as Supercluster, porId);
  return indice as Supercluster;
}

/**
 * O que materializar no DOM para este enquadramento e zoom. Os `fixos`
 * (marcados) saem sempre como pontos soltos, mesmo fora do bbox ou dentro de um
 * grupo — e nesse caso continuam contados no total do grupo.
 */
export function itensVisiveis(
  index: Supercluster,
  bbox: [number, number, number, number],
  zoom: number,
  fixos: Set<string>,
): { clusters: ClusterVisivel[]; pontos: StockMapPoint[] } {
  const porId = pontosDoIndice.get(index) ?? new Map<string, StockMapPoint>();
  const clusters: ClusterVisivel[] = [];
  const pontos: StockMapPoint[] = [];
  if (porId.size === 0) return { clusters, pontos };

  for (const f of index.getClusters(bbox, Math.floor(zoom))) {
    const [lng, lat] = f.geometry.coordinates;
    const props = f.properties as Supercluster.ClusterProperties | PropsPonto;
    if ('cluster' in props && props.cluster) {
      clusters.push({ id: props.cluster_id, lngLat: [lng, lat], total: props.point_count });
      continue;
    }
    const id = (props as PropsPonto).id;
    if (fixos.has(id)) continue;
    const p = porId.get(id);
    if (p) pontos.push(p);
  }
  for (const id of fixos) {
    const p = porId.get(id);
    if (p) pontos.push(p);
  }
  return { clusters, pontos };
}
