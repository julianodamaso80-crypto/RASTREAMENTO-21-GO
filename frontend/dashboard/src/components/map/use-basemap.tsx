'use client';

import { createContext, useContext, useEffect, useState, type ReactNode, type RefObject } from 'react';
import type maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { BASEMAPS, type BasemapId } from '@/lib/constants';
import { resolveSatelliteStyle, type TilesSource } from '@/lib/basemap';
import { mapApi } from '@/lib/api';
import { BasemapToggle } from './basemap-toggle';
import { GoogleMapsAttribution } from './google-attribution';

/**
 * De onde vem a sessão do satélite do Google. O painel usa o login do time;
 * a área do associado e o link público de localização usam a rota do mundo
 * deles (o token de um não vale no outro). Quem não declara nada é painel.
 */
const PAINEL: TilesSource = {
  chave: 'painel',
  getTiles: () => mapApi.getTiles('satellite'),
  getAttribution: (b) => mapApi.getAttribution(b),
};

const TilesSourceContext = createContext<TilesSource>(PAINEL);

export function MapTilesSourceProvider({ source, children }: { source: TilesSource; children: ReactNode }) {
  return <TilesSourceContext.Provider value={source}>{children}</TilesSourceContext.Provider>;
}

/**
 * Troca de estilo que não apaga o que a tela desenhou. Os mapas de base
 * (CARTO, MapTiler, Esri, Google) só usam fontes vector/raster; tudo que é
 * `geojson` (trajeto, rota, cerca) é da tela e passa para o estilo novo.
 * Marcadores são DOM e não dependem do estilo.
 */
function manterCamadasDaTela(prev: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  if (!prev) return next;
  const daTela = Object.entries(prev.sources ?? {}).filter(([, s]) => s.type === 'geojson');
  if (daTela.length === 0) return next;
  const ids = new Set(daTela.map(([id]) => id));
  return {
    ...next,
    glyphs: next.glyphs ?? prev.glyphs,
    sources: { ...next.sources, ...Object.fromEntries(daTela) },
    layers: [
      ...next.layers,
      ...prev.layers.filter((l) => 'source' in l && typeof l.source === 'string' && ids.has(l.source)),
    ],
  };
}

/**
 * Os três mapas (Padrão, Satélite grátis, Satélite Google) em qualquer mapa
 * MapLibre. Devolve o seletor e a atribuição do Google já posicionados — a
 * caixa do mapa precisa ser `relative`.
 */
export function useBasemap(
  mapRef: RefObject<maplibregl.Map | null>,
  opts: { toggleClassName?: string; source?: TilesSource } = {},
) {
  const doContexto = useContext(TilesSourceContext);
  const source = opts.source ?? doContexto;
  const toggleClassName = opts.toggleClassName;
  const [basemap, setBasemap] = useState<BasemapId>('streets');
  const [satProvider, setSatProvider] = useState<'google' | 'esri' | null>(null);
  const [googleMinZoom, setGoogleMinZoom] = useState<number | null>(null);
  const [googleVisible, setGoogleVisible] = useState(false);
  const [googleCopyright, setGoogleCopyright] = useState('');
  const [aplicado, setAplicado] = useState<BasemapId>('streets');

  useEffect(() => {
    const map = mapRef.current;
    // O mapa nasce no Padrão; só troca quando a pessoa escolhe outro.
    if (!map || basemap === aplicado) return;
    const def = BASEMAPS.find((b) => b.id === basemap);
    if (!def) return;
    let cancelado = false;

    const aplicar = (style: string | StyleSpecification) => {
      if (cancelado) return;
      map.setStyle(style, { diff: false, transformStyle: manterCamadasDaTela });
      setAplicado(basemap);
    };

    if (basemap === 'satellite-google') {
      resolveSatelliteStyle(source).then(({ provider, style, googleMinZoom: minZoom }) => {
        if (cancelado) return;
        setSatProvider(provider);
        setGoogleMinZoom(minZoom);
        aplicar(style);
      });
    } else {
      setSatProvider(null);
      setGoogleMinZoom(null);
      setGoogleVisible(false);
      setGoogleCopyright('');
      aplicar(def.url);
    }
    return () => {
      cancelado = true;
    };
  }, [basemap, aplicado, mapRef, source]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || googleMinZoom === null) {
      setGoogleVisible(false);
      return;
    }
    const conferir = () => setGoogleVisible(map.getZoom() >= googleMinZoom);
    conferir();
    map.on('zoomend', conferir);
    return () => {
      map.off('zoomend', conferir);
    };
  }, [googleMinZoom, mapRef]);

  // Atribuição do viewport exigida pela política do Google (não consome cota).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !googleVisible) return;
    let timer: ReturnType<typeof setTimeout>;
    const atualizar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const b = map.getBounds();
        source
          .getAttribution({
            zoom: Math.round(map.getZoom()),
            north: b.getNorth(),
            south: b.getSouth(),
            east: b.getEast(),
            west: b.getWest(),
          })
          .then(({ copyright }) => setGoogleCopyright(copyright))
          .catch(() => setGoogleCopyright('Google'));
      }, 600);
    };
    atualizar();
    map.on('moveend', atualizar);
    return () => {
      clearTimeout(timer);
      map.off('moveend', atualizar);
    };
  }, [googleVisible, mapRef, source]);

  const controles = (
    <>
      <BasemapToggle current={basemap} onChange={setBasemap} className={toggleClassName} />
      {satProvider === 'google' && googleVisible && <GoogleMapsAttribution copyright={googleCopyright} />}
      {basemap === 'satellite-google' && satProvider === 'google' && !googleVisible && (
        <div className="pointer-events-none absolute bottom-8 left-2 z-10 rounded-md bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow-md backdrop-blur-md">
          Aproxime o zoom para a imagem em alta do Google
        </div>
      )}
    </>
  );

  return { basemap, controles };
}
