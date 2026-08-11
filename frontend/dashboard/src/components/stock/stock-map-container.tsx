'use client';

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_CENTER, MAP_ZOOM, BASEMAPS, type BasemapId } from '@/lib/constants';
import { resolveSatelliteStyle, type SatelliteProvider } from '@/lib/basemap';
import { mapApi } from '@/lib/api';
import type { StockMapPoint } from '@/types/stock';
import { BasemapToggle } from '@/components/map/basemap-toggle';
import { GoogleMapsAttribution } from '@/components/map/google-attribution';

export interface StockMapRef {
  flyTo: (lng: number, lat: number, zoom?: number, paddingRight?: number) => void;
  fitAll: () => void;
}

interface Props {
  pontos: StockMapPoint[];
  selecionadoId: string | null;
  onSelect: (id: string) => void;
}

/** Cor do marcador pelo estado de conexão — mesma leitura da lista lateral. */
export function corDaConexao(ponto: StockMapPoint): string {
  if (ponto.conexao === 'ONLINE') return '#10b981';
  if (ponto.conexao === 'SLEEP') return '#38bdf8';
  if (ponto.conexao === 'NUNCA') return '#94a3b8';
  return '#ef4444';
}

/**
 * Mapa do estoque: uma seta por rastreador, na última posição conhecida.
 *
 * Separado do mapa de veículos de propósito. Lá o objeto é um carro instalado,
 * com placa, tipo e regra de "posição fresca ou nada". Aqui o objeto é um
 * equipamento que pode estar na prateleira há semanas ou na mão do técnico a
 * caminho da instalação — e o operador PRECISA ver a última posição conhecida,
 * com a idade dela na cara, pra decidir. Misturar as duas telas obrigaria a
 * enfraquecer a regra do mapa de rastreamento, que é crítica.
 */
const StockMapContainer = forwardRef<StockMapRef, Props>(
  function StockMapContainer({ pontos, selecionadoId, onSelect }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const [basemap, setBasemap] = useState<BasemapId>('streets');
    const [satProvider, setSatProvider] = useState<SatelliteProvider | null>(null);
    const [googleMinZoom, setGoogleMinZoom] = useState<number | null>(null);
    const [googleVisible, setGoogleVisible] = useState(false);
    const [googleCopyright, setGoogleCopyright] = useState('');

    const comPosicao = pontos.filter(
      (p) => p.latitude !== null && p.longitude !== null,
    );

    useImperativeHandle(ref, () => ({
      flyTo: (lng, lat, zoom = 16, paddingRight = 0) => {
        mapRef.current?.flyTo({
          center: [lng, lat],
          zoom,
          duration: 900,
          padding: { top: 0, bottom: 0, left: 0, right: paddingRight },
        });
      },
      fitAll: () => {
        const map = mapRef.current;
        if (!map || comPosicao.length === 0) return;
        const bounds = new maplibregl.LngLatBounds();
        comPosicao.forEach((p) => bounds.extend([p.longitude!, p.latitude!]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 800 });
      },
    }));

    useEffect(() => {
      if (!containerRef.current || mapRef.current) return;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: BASEMAPS[0].url,
        center: MAP_CENTER,
        zoom: MAP_ZOOM,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        'bottom-left',
      );
      mapRef.current = map;
      return () => {
        markersRef.current.forEach((m) => m.remove());
        markersRef.current.clear();
        map.remove();
        mapRef.current = null;
      };
    }, []);

    // Troca de basemap preservando os marcadores (setStyle limpa markers DOM
    // em algumas versões do MapLibre — sem o re-attach o operador perde os
    // equipamentos de vista ao trocar pra satélite).
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      const def = BASEMAPS.find((b) => b.id === basemap);
      if (!def || !def.url) return;

      let cancelled = false;

      const applyStyle = (style: Parameters<typeof map.setStyle>[0]) => {
        if (cancelled) return;
        const snapshot = Array.from(markersRef.current.entries()).map(
          ([id, marker]) => ({
            id,
            lngLat: marker.getLngLat(),
            el: marker.getElement(),
          }),
        );
        map.setStyle(style);
        map.once('styledata', () => {
          snapshot.forEach(({ id, lngLat, el }) => {
            markersRef.current.get(id)?.remove();
            const novo = new maplibregl.Marker({ element: el })
              .setLngLat(lngLat)
              .addTo(map);
            markersRef.current.set(id, novo);
          });
        });
      };

      if (basemap === 'satellite-google') {
        resolveSatelliteStyle().then(({ provider, style, googleMinZoom: min }) => {
          if (cancelled) return;
          setSatProvider(provider);
          setGoogleMinZoom(min);
          applyStyle(style);
        });
      } else {
        setSatProvider(null);
        setGoogleMinZoom(null);
        setGoogleVisible(false);
        setGoogleCopyright('');
        applyStyle(def.url);
      }

      return () => {
        cancelled = true;
      };
    }, [basemap]);

    useEffect(() => {
      const map = mapRef.current;
      if (!map || googleMinZoom === null) {
        setGoogleVisible(false);
        return;
      }
      const check = () => setGoogleVisible(map.getZoom() >= googleMinZoom);
      check();
      map.on('zoomend', check);
      return () => {
        map.off('zoomend', check);
      };
    }, [googleMinZoom]);

    // Atribuição do viewport exigida pela política do Google.
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !googleVisible) return;
      let timer: ReturnType<typeof setTimeout>;
      const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const b = map.getBounds();
          mapApi
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
      refresh();
      map.on('moveend', refresh);
      return () => {
        clearTimeout(timer);
        map.off('moveend', refresh);
      };
    }, [googleVisible]);

    const criarMarcador = useCallback(
      (ponto: StockMapPoint, selecionado: boolean) => {
        const el = document.createElement('div');
        // width/height fixos: sem isso o div vira block, estica pela largura do
        // mapa e o ícone aparece deslocado do ponto real.
        el.style.cssText =
          'cursor:pointer;position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;';

        const cor = corDaConexao(ponto);
        const giro = ponto.direcao ?? 0;
        const forma = `<svg width="26" height="26" viewBox="0 0 24 24" style="transform:rotate(${giro}deg)">
             <path d="M12 2 L19 21 L12 17 L5 21 Z" fill="${cor}" stroke="#0f172a" stroke-width="1.2" stroke-linejoin="round"/>
           </svg>`;

        el.innerHTML = `
          <div style="position:absolute;width:${selecionado ? 42 : 34}px;height:${selecionado ? 42 : 34}px;border-radius:50%;border:2px solid ${cor};background:rgba(15,23,42,0.35);box-shadow:0 2px 8px rgba(0,0,0,0.5);"></div>
          <div style="position:relative;z-index:1;display:flex;align-items:center;justify-content:center;">${forma}</div>
        `;

        const tooltip = document.createElement('div');
        tooltip.style.cssText =
          'display:none;position:absolute;bottom:100%;left:50%;transform:translateX(-50%);padding:6px 10px;background:rgba(15,23,42,0.95);border:1px solid rgba(148,163,184,0.2);border-radius:6px;white-space:nowrap;font-size:12px;color:#e2e8f0;z-index:10;pointer-events:none;margin-bottom:6px;';
        tooltip.innerHTML = `<div style="font-weight:600;color:${cor}">${ponto.imei}</div><div>${ponto.conexao}</div>`;
        el.appendChild(tooltip);
        el.onmouseenter = () => {
          tooltip.style.display = 'block';
        };
        el.onmouseleave = () => {
          tooltip.style.display = 'none';
        };
        el.onclick = (e) => {
          e.stopPropagation();
          onSelect(ponto.id);
        };
        return el;
      },
      [onSelect],
    );

    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      const vivos = new Set<string>();

      for (const ponto of comPosicao) {
        vivos.add(ponto.id);
        const lngLat: [number, number] = [ponto.longitude!, ponto.latitude!];
        const selecionado = ponto.id === selecionadoId;
        const chave = `${ponto.conexao}|${ponto.gpsConfiavel}|${ponto.direcao}|${selecionado}`;
        const existente = markersRef.current.get(ponto.id);

        if (existente) {
          existente.setLngLat(lngLat);
          const el = existente.getElement();
          if (el.dataset.chave !== chave) {
            const novoEl = criarMarcador(ponto, selecionado);
            novoEl.dataset.chave = chave;
            el.replaceWith(novoEl);
            (existente as unknown as { _element: HTMLElement })._element = novoEl;
          }
        } else {
          const el = criarMarcador(ponto, selecionado);
          el.dataset.chave = chave;
          markersRef.current.set(
            ponto.id,
            new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map),
          );
        }
      }

      markersRef.current.forEach((marker, id) => {
        if (!vivos.has(id)) {
          marker.remove();
          markersRef.current.delete(id);
        }
      });
    }, [comPosicao, selecionadoId, criarMarcador]);

    return (
      <div className="relative h-full w-full">
        <div ref={containerRef} className="h-full w-full" />
        <BasemapToggle current={basemap} onChange={setBasemap} />
        {satProvider === 'google' && googleVisible && (
          <GoogleMapsAttribution copyright={googleCopyright} />
        )}
      </div>
    );
  },
);

export default StockMapContainer;
