import type { StyleSpecification } from 'maplibre-gl';
import { mapApi } from './api';
import { ESRI_SATELLITE_STYLE } from './constants';

export type SatelliteProvider = 'google' | 'esri';

export interface ResolvedSatellite {
  provider: SatelliteProvider;
  style: StyleSpecification;
}

/**
 * O satélite do Google exige uma sessão criada no backend. Se a chave não
 * estiver configurada, ou a API falhar, cai no Esri — o mapa NUNCA pode
 * ficar em branco durante um rastreamento (Regra 0).
 */
let cached: { value: ResolvedSatellite; expiresAt: number } | null = null;

const esriFallback = (): ResolvedSatellite => ({
  provider: 'esri',
  style: ESRI_SATELLITE_STYLE,
});

export async function resolveSatelliteStyle(): Promise<ResolvedSatellite> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const source = await mapApi.getTiles('satellite');
    if (source.provider !== 'google') return esriFallback();

    const style = {
      version: 8,
      sources: {
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
      layers: [{ id: 'google-satellite', type: 'raster', source: 'google-satellite' }],
    } as StyleSpecification;

    const value: ResolvedSatellite = { provider: 'google', style };
    // Renova bem antes do expiry do token pra nunca servir sessão morta.
    cached = { value, expiresAt: Math.min(source.expiresAt, Date.now() + 60 * 60 * 1000) };
    return value;
  } catch {
    return esriFallback();
  }
}
