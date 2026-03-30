'use client';

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_CENTER, MAP_ZOOM, CARTO_DARK_MATTER_URL, STATUS_COLORS } from '@/lib/constants';
import { formatSpeed, formatRelativeTime } from '@/lib/utils';
import type { VehicleWithTracking } from '@/types/vehicle';

export interface MapContainerRef {
  flyTo: (lng: number, lat: number, zoom?: number) => void;
}

interface MapContainerProps {
  vehicles: VehicleWithTracking[];
  onVehicleClick?: (vehicleId: string) => void;
}

const MapContainer = forwardRef<MapContainerRef, MapContainerProps>(
  function MapContainer({ vehicles, onVehicleClick }, ref) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const popupRef = useRef<maplibregl.Popup | null>(null);

    useImperativeHandle(ref, () => ({
      flyTo: (lng: number, lat: number, zoom = 15) => {
        mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1000 });
      },
    }));

    // Inicializar mapa
    useEffect(() => {
      if (!mapContainerRef.current || mapRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: CARTO_DARK_MATTER_URL,
        center: MAP_CENTER,
        zoom: MAP_ZOOM,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

      mapRef.current = map;

      return () => {
        map.remove();
        mapRef.current = null;
      };
    }, []);

    // Criar marcador HTML
    const createMarkerElement = useCallback(
      (vehicle: VehicleWithTracking) => {
        const el = document.createElement('div');
        el.className = 'vehicle-marker-container';
        el.style.cssText = 'cursor: pointer; position: relative;';

        const color = STATUS_COLORS[vehicle.displayStatus];
        const isMoving = vehicle.displayStatus === 'moving';

        el.innerHTML = `
          ${isMoving ? `<div class="vehicle-pulse" style="position:absolute;width:32px;height:32px;border-radius:50%;background:${color};opacity:0.3;top:50%;left:50%;transform:translate(-50%,-50%);"></div>` : ''}
          <div style="width:32px;height:32px;position:relative;z-index:1;">
            <svg viewBox="0 0 24 24" width="32" height="32" style="transform:rotate(${vehicle.course}deg);filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
              <path d="M12 2L4.5 20.3L5.2 21L12 18L18.8 21L19.5 20.3L12 2Z" fill="${color}" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>
            </svg>
          </div>
        `;

        // Tooltip no hover
        const tooltip = document.createElement('div');
        tooltip.style.cssText =
          'display:none;position:absolute;bottom:100%;left:50%;transform:translateX(-50%);padding:6px 10px;background:rgba(15,23,42,0.95);border:1px solid rgba(148,163,184,0.15);border-radius:6px;white-space:nowrap;font-size:12px;color:#e2e8f0;z-index:10;pointer-events:none;margin-bottom:4px;backdrop-filter:blur(8px);';
        tooltip.innerHTML = `
          <div style="font-weight:600;color:${color}">${vehicle.plate}</div>
          <div>${formatSpeed(vehicle.speed)} · ${formatRelativeTime(vehicle.lastUpdate)}</div>
        `;
        el.appendChild(tooltip);

        el.onmouseenter = () => { tooltip.style.display = 'block'; };
        el.onmouseleave = () => { tooltip.style.display = 'none'; };

        el.onclick = (e) => {
          e.stopPropagation();
          onVehicleClick?.(vehicle.id);
        };

        return el;
      },
      [onVehicleClick],
    );

    // Atualizar marcadores
    useEffect(() => {
      if (!mapRef.current) return;

      const currentIds = new Set<string>();

      for (const vehicle of vehicles) {
        if (!vehicle.latitude || !vehicle.longitude) continue;
        currentIds.add(vehicle.id);

        const existing = markersRef.current.get(vehicle.id);
        if (existing) {
          // Atualizar posição
          existing.setLngLat([vehicle.longitude, vehicle.latitude]);
          // Atualizar elemento
          const el = createMarkerElement(vehicle);
          existing.getElement().replaceWith(el);
          existing.getElement = () => el;
        } else {
          // Criar novo marcador
          const el = createMarkerElement(vehicle);
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([vehicle.longitude, vehicle.latitude])
            .addTo(mapRef.current!);
          markersRef.current.set(vehicle.id, marker);
        }
      }

      // Remover marcadores de veículos não mais na lista
      markersRef.current.forEach((marker, id) => {
        if (!currentIds.has(id)) {
          marker.remove();
          markersRef.current.delete(id);
        }
      });
    }, [vehicles, createMarkerElement]);

    return (
      <div ref={mapContainerRef} className="w-full h-full" />
    );
  },
);

export default MapContainer;
