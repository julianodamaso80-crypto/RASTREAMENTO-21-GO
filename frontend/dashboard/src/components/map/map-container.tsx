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
import {
  MAP_CENTER,
  MAP_ZOOM,
  BASEMAPS,
  STATUS_COLORS,
  VEHICLE_ICONS,
  type BasemapId,
} from '@/lib/constants';
import { formatSpeed, formatRelativeTime } from '@/lib/utils';
import type { VehicleWithTracking } from '@/types/vehicle';
import { BasemapToggle } from './basemap-toggle';

export interface MapContainerRef {
  flyTo: (lng: number, lat: number, zoom?: number) => void;
}

interface MapContainerProps {
  vehicles: VehicleWithTracking[];
  onVehicleClick?: (vehicleId: string) => void;
}

/**
 * Renderiza 1 marker DOM por veículo. Simples e direto.
 *
 * Decisão arquitetural: clustering nativo do MapLibre foi removido porque
 * apresentava bugs de sincronização (DOM marker não aparecia até pan/zoom
 * manual) e a base de veículos hoje é pequena (≤100 ativos).
 *
 * Quando passar de ~500 ativos, adicionar clustering com a lib
 * `supercluster` (melhor controle que o cluster nativo), mantendo este
 * componente como fallback pra clientes individuais (visão CLIENT).
 */
const MapContainer = forwardRef<MapContainerRef, MapContainerProps>(
  function MapContainer({ vehicles, onVehicleClick }, ref) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const [basemap, setBasemap] = useState<BasemapId>('streets');

    useImperativeHandle(ref, () => ({
      flyTo: (lng: number, lat: number, zoom = 15) => {
        // padding.right=380 compensa o painel direito (VehicleDetailPanel)
        // pra centralizar o ponto na área visualmente útil, não no centro
        // geométrico do canvas (que ficaria atrás do painel).
        mapRef.current?.flyTo({
          center: [lng, lat],
          zoom,
          duration: 1000,
          padding: { top: 0, bottom: 0, left: 0, right: 380 },
        });
      },
    }));

    // ─────────────────────────────────────────────────────────────────
    // Inicializa mapa (uma vez só — não depende de `basemap`)
    // ─────────────────────────────────────────────────────────────────
    useEffect(() => {
      if (!mapContainerRef.current || mapRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
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

    // ─────────────────────────────────────────────────────────────────
    // Troca de basemap (Padrão ↔ Satélite). MapLibre limpa os markers
    // DOM ao chamar setStyle em algumas versões — re-attach manual após
    // o `styledata` garantindo que o pin do veículo continua visível.
    // CRÍTICO em rastreamento: se o usuário troca pra satélite e o pin
    // some, ele perde o veículo de vista.
    // ─────────────────────────────────────────────────────────────────
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      const def = BASEMAPS.find((b) => b.id === basemap);
      if (!def || !def.url) return;

      const snapshot = Array.from(markersRef.current.entries()).map(
        ([id, marker]) => ({ id, lngLat: marker.getLngLat(), el: marker.getElement() }),
      );

      map.setStyle(def.url);

      map.once('styledata', () => {
        snapshot.forEach(({ id, lngLat, el }) => {
          const existing = markersRef.current.get(id);
          existing?.remove();
          const newMarker = new maplibregl.Marker({ element: el })
            .setLngLat(lngLat)
            .addTo(map);
          markersRef.current.set(id, newMarker);
        });
      });
    }, [basemap]);

    // ─────────────────────────────────────────────────────────────────
    // Cria o elemento DOM do marker (seta direcional com cor por status)
    // ─────────────────────────────────────────────────────────────────
    const createMarkerElement = useCallback(
      (vehicle: VehicleWithTracking) => {
        const el = document.createElement('div');
        el.className = 'vehicle-marker-container';
        // width/height FIXOS são essenciais: sem isso o div vira block e estica
        // pra largura inteira do mapa, jogando o ícone ~350px pra esquerda do
        // ponto real (o veículo "some" do lugar certo). Comprovado via teste.
        el.style.cssText =
          'cursor:pointer;position:relative;width:54px;height:54px;display:flex;align-items:center;justify-content:center;';

        const color = STATUS_COLORS[vehicle.displayStatus];
        // Pulse só quando carro REALMENTE está se movendo (motor ligado +
        // velocidade > 0). Não pulsa só por ignição ligada parado.
        const isMoving =
          vehicle.displayStatus === 'ignition_on' && vehicle.speed > 0;

        // Desenho REALISTA do veículo (carro/moto vista de cima) girando na
        // direção real, com anel colorido por status pra leitura rápida e
        // sombra pra destacar em qualquer basemap (satélite/streets/dark).
        const icon = VEHICLE_ICONS[vehicle.vehicleType] ?? VEHICLE_ICONS.CAR;
        el.innerHTML = `
          ${isMoving ? `<div class="vehicle-pulse" style="position:absolute;width:60px;height:60px;border-radius:50%;background:${color};opacity:0.3;top:50%;left:50%;transform:translate(-50%,-50%);"></div>` : ''}
          <div style="width:54px;height:54px;position:relative;z-index:1;display:flex;align-items:center;justify-content:center;">
            <div style="position:absolute;width:50px;height:50px;border-radius:50%;border:3px solid ${color};background:rgba(15,23,42,0.25);box-shadow:0 0 0 1px rgba(0,0,0,0.35),0 2px 8px rgba(0,0,0,0.55);"></div>
            <img src="${icon}" width="44" height="44" alt="" draggable="false"
              style="position:relative;z-index:2;transform:rotate(${vehicle.course}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.7));pointer-events:none;" />
          </div>
        `;

        // Tooltip ao passar o mouse
        const tooltip = document.createElement('div');
        tooltip.style.cssText =
          'display:none;position:absolute;bottom:100%;left:50%;transform:translateX(-50%);padding:6px 10px;background:rgba(15,23,42,0.95);border:1px solid rgba(148,163,184,0.15);border-radius:6px;white-space:nowrap;font-size:12px;color:#e2e8f0;z-index:10;pointer-events:none;margin-bottom:6px;backdrop-filter:blur(8px);';
        const tooltipSpeed = isMoving ? formatSpeed(vehicle.speed) : '0 km/h';
        const tooltipTime = formatRelativeTime(
          vehicle.positionTime ?? vehicle.lastUpdate,
        );
        tooltip.innerHTML = `
          <div style="font-weight:600;color:${color}">${vehicle.plate}</div>
          <div>${tooltipSpeed} · GPS ${tooltipTime}</div>
        `;
        el.appendChild(tooltip);

        el.onmouseenter = () => {
          tooltip.style.display = 'block';
        };
        el.onmouseleave = () => {
          tooltip.style.display = 'none';
        };

        el.onclick = (e) => {
          e.stopPropagation();
          onVehicleClick?.(vehicle.id);
        };

        return el;
      },
      [onVehicleClick],
    );

    // ─────────────────────────────────────────────────────────────────
    // Sincroniza markers com a lista de vehicles
    // ─────────────────────────────────────────────────────────────────
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      const currentIds = new Set<string>();

      for (const vehicle of vehicles) {
        if (!vehicle.latitude || !vehicle.longitude) continue;
        currentIds.add(vehicle.id);

        const existing = markersRef.current.get(vehicle.id);
        const lngLat: [number, number] = [vehicle.longitude, vehicle.latitude];

        if (existing) {
          existing.setLngLat(lngLat);
          // Substitui o elemento DOM pra refletir mudança de course/status/etc.
          const newEl = createMarkerElement(vehicle);
          const oldEl = existing.getElement();
          oldEl.replaceWith(newEl);
          // Atualiza a referência interna do MapLibre Marker pra apontar pro
          // novo elemento (caso contrário, eventos como drag deixariam de
          // funcionar — embora não usemos drag).
          (existing as unknown as { _element: HTMLElement })._element = newEl;
        } else {
          const el = createMarkerElement(vehicle);
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat(lngLat)
            .addTo(map);
          markersRef.current.set(vehicle.id, marker);
        }
      }

      // Remove markers que sumiram da lista
      markersRef.current.forEach((marker, id) => {
        if (!currentIds.has(id)) {
          marker.remove();
          markersRef.current.delete(id);
        }
      });
    }, [vehicles, createMarkerElement]);

    return (
      <div className="relative w-full h-full">
        <div ref={mapContainerRef} className="w-full h-full" />
        <BasemapToggle current={basemap} onChange={setBasemap} />
      </div>
    );
  },
);

export default MapContainer;
