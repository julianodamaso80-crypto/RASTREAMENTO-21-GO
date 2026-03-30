'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CARTO_DARK_MATTER_URL, MAP_CENTER } from '@/lib/constants';
import type { TraccarPosition } from '@/types/traccar';

interface RouteMapProps {
  positions: TraccarPosition[];
}

export function RouteMap({ positions }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: CARTO_DARK_MATTER_URL,
      center: MAP_CENTER,
      zoom: 12,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Desenhar rota quando positions mudam
  useEffect(() => {
    const map = mapRef.current;
    if (!map || positions.length === 0) return;

    function drawRoute() {
      if (!map) return;

      // Remover layers anteriores
      if (map.getSource('route')) {
        map.removeLayer('route-line');
        map.removeSource('route');
      }

      const coords = positions.map((p) => [p.longitude, p.latitude] as [number, number]);

      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coords },
        },
      });

      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#10b981',
          'line-width': 3,
          'line-opacity': 0.8,
        },
      });

      // Marcadores de início e fim
      const start = positions[0];
      const end = positions[positions.length - 1];

      // Remover marcadores anteriores
      document.querySelectorAll('.route-marker').forEach((el) => el.remove());

      const startEl = document.createElement('div');
      startEl.className = 'route-marker';
      startEl.style.cssText = 'width:14px;height:14px;background:#10b981;border:2px solid white;border-radius:50%;';
      new maplibregl.Marker({ element: startEl })
        .setLngLat([start.longitude, start.latitude])
        .addTo(map);

      const endEl = document.createElement('div');
      endEl.className = 'route-marker';
      endEl.style.cssText = 'width:14px;height:14px;background:#ef4444;border:2px solid white;border-radius:50%;';
      new maplibregl.Marker({ element: endEl })
        .setLngLat([end.longitude, end.latitude])
        .addTo(map);

      // Fit bounds
      const bounds = new maplibregl.LngLatBounds();
      coords.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds, { padding: 60, duration: 1000 });
    }

    if (map.isStyleLoaded()) {
      drawRoute();
    } else {
      map.on('load', drawRoute);
    }
  }, [positions]);

  return <div ref={containerRef} className="w-full h-full min-h-[300px] rounded-lg overflow-hidden" />;
}
