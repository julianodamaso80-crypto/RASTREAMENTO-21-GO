'use client';

import {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  MAP_CENTER,
  MAP_ZOOM,
  MAP_STYLE_URL,
  STATUS_COLORS,
} from '@/lib/constants';
import { formatSpeed, formatRelativeTime } from '@/lib/utils';
import type { VehicleWithTracking } from '@/types/vehicle';

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
    // Inicializa mapa
    // ─────────────────────────────────────────────────────────────────
    useEffect(() => {
      if (!mapContainerRef.current || mapRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: MAP_STYLE_URL,
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
    // Cria o elemento DOM do marker (seta direcional com cor por status)
    // ─────────────────────────────────────────────────────────────────
    const createMarkerElement = useCallback(
      (vehicle: VehicleWithTracking) => {
        const el = document.createElement('div');
        el.className = 'vehicle-marker-container';
        el.style.cssText = 'cursor: pointer; position: relative;';

        const color = STATUS_COLORS[vehicle.displayStatus];
        const isMoving = vehicle.displayStatus === 'moving';

        // Stroke escuro + sombra forte: visível em qualquer fundo (claro/escuro).
        el.innerHTML = `
          ${isMoving ? `<div class="vehicle-pulse" style="position:absolute;width:48px;height:48px;border-radius:50%;background:${color};opacity:0.35;top:50%;left:50%;transform:translate(-50%,-50%);"></div>` : ''}
          <div style="width:40px;height:40px;position:relative;z-index:1;">
            <svg viewBox="0 0 24 24" width="40" height="40" style="transform:rotate(${vehicle.course}deg);filter:drop-shadow(0 2px 6px rgba(0,0,0,0.6));">
              <path d="M12 2L4.5 20.3L5.2 21L12 18L18.8 21L19.5 20.3L12 2Z" fill="${color}" stroke="#1e293b" stroke-width="1.2"/>
            </svg>
          </div>
        `;

        // Tooltip ao passar o mouse
        const tooltip = document.createElement('div');
        tooltip.style.cssText =
          'display:none;position:absolute;bottom:100%;left:50%;transform:translateX(-50%);padding:6px 10px;background:rgba(15,23,42,0.95);border:1px solid rgba(148,163,184,0.15);border-radius:6px;white-space:nowrap;font-size:12px;color:#e2e8f0;z-index:10;pointer-events:none;margin-bottom:6px;backdrop-filter:blur(8px);';
        tooltip.innerHTML = `
          <div style="font-weight:600;color:${color}">${vehicle.plate}</div>
          <div>${formatSpeed(vehicle.speed)} · ${formatRelativeTime(vehicle.lastUpdate)}</div>
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

    return <div ref={mapContainerRef} className="w-full h-full" />;
  },
);

export default MapContainer;
