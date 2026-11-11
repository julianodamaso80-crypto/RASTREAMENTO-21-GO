import type { StyleSpecification } from 'maplibre-gl';
import { mapApi } from './api';
import { ESRI_SATELLITE_STYLE } from './constants';

export type SatelliteProvider = 'google' | 'esri';

/** Quem entrega a sessão do Google: painel, associado ou link público. */
export interface TilesSource {
  /** Separa o cache: cada mundo pede a sessão pela própria rota. */
  chave: string;
  getTiles: () => ReturnType<typeof mapApi.getTiles>;
  getAttribution: (b: {
    zoom: number;
    north: number;
    south: number;
    east: number;
    west: number;
  }) => Promise<{ copyright: string }>;
}

export interface ResolvedSatellite {
  provider: SatelliteProvider;
  style: StyleSpecification;
  /** A partir de que zoom o Google entra em cena (null = nunca). */
  googleMinZoom: number | null;
}

/**
 * O satélite do Google exige uma sessão criada no backend. Se a chave não
 * estiver configurada, ou a API falhar, cai no Esri — o mapa NUNCA pode
 * ficar em branco durante um rastreamento (Regra 0).
 */
const cache = new Map<string, { value: ResolvedSatellite; expiresAt: number }>();

const esriFallback = (): ResolvedSatellite => ({
  provider: 'esri',
  style: ESRI_SATELLITE_STYLE,
  googleMinZoom: null,
});

export async function resolveSatelliteStyle(
  origem: TilesSource = { chave: 'painel', getTiles: () => mapApi.getTiles('satellite'), getAttribution: mapApi.getAttribution },
): Promise<ResolvedSatellite> {
  const cached = cache.get(origem.chave);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const source = await origem.getTiles();
    if (source.provider !== 'google') return esriFallback();

    // Estilo em duas camadas: Esri por baixo (grátis, cobre todos os zooms) e
    // Google por cima só a partir de minzoom. O MapLibre não baixa tiles de
    // uma layer fora da faixa de zoom, então longe de perto NÃO gera custo.
    // O Esri continua embaixo de propósito: se um tile do Google falhar,
    // aparece a imagem antiga em vez de um buraco preto.
    const style = {
      ...ESRI_SATELLITE_STYLE,
      sources: {
        ...ESRI_SATELLITE_STYLE.sources,
        'google-satellite': {
          type: 'raster',
          tiles: source.tiles,
          tileSize: source.tileSize,
          maxzoom: source.maxzoom,
          // Vazio de propósito: a atribuição do Google é renderizada pelo
          // componente GoogleMapsAttribution, com o logo oficial exigido
          // pela política da Map Tiles API.
          attribution: '',
        },
      },
      layers: [
        ...ESRI_SATELLITE_STYLE.layers,
        {
          id: 'google-satellite',
          type: 'raster',
          source: 'google-satellite',
          minzoom: source.minzoom,
        },
      ],
    } as StyleSpecification;

    const value: ResolvedSatellite = {
      provider: 'google',
      style,
      googleMinZoom: source.minzoom,
    };
    // Renova bem antes do expiry do token pra nunca servir sessão morta.
    cache.set(origem.chave, { value, expiresAt: Math.min(source.expiresAt, Date.now() + 60 * 60 * 1000) });
    return value;
  } catch {
    return esriFallback();
  }
}
