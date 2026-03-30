'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CARTO_DARK_MATTER_URL, MAP_CENTER } from '@/lib/constants';
import type { Geofence } from '@/types/geofence';

interface GeofenceMapProps {
  geofences: Geofence[];
  selectedId: string | null;
}

function createCircleGeoJSON(lat: number, lng: number, radiusMeters: number, steps = 64): GeoJSON.Feature {
  const coords: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);
    const dlng = dx / (111320 * Math.cos((lat * Math.PI) / 180));
    const dlat = dy / 110540;
    coords.push([lng + dlng, lat + dlat]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

export function GeofenceMap({ geofences, selectedId }: GeofenceMapProps) {
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
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function drawGeofences() {
      if (!map) return;

      // Limpar layers/sources anteriores
      geofences.forEach((_, i) => {
        const id = `geofence-${i}`;
        if (map.getLayer(`${id}-fill`)) map.removeLayer(`${id}-fill`);
        if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`);
        if (map.getSource(id)) map.removeSource(id);
      });
      // Limpar extras
      for (let i = geofences.length; i < geofences.length + 10; i++) {
        const id = `geofence-${i}`;
        if (map.getLayer(`${id}-fill`)) map.removeLayer(`${id}-fill`);
        if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`);
        if (map.getSource(id)) map.removeSource(id);
      }

      const bounds = new maplibregl.LngLatBounds();
      let hasGeofences = false;

      geofences.forEach((gf, i) => {
        const id = `geofence-${i}`;
        const isSelected = gf.id === selectedId;
        let feature: GeoJSON.Feature;

        if (gf.type === 'CIRCLE') {
          const coords = gf.coordinates as { latitude: number; longitude: number; radius: number };
          feature = createCircleGeoJSON(coords.latitude, coords.longitude, coords.radius);
          bounds.extend([coords.longitude, coords.latitude]);
          hasGeofences = true;
        } else {
          const polygon = gf.coordinates as number[][];
          if (polygon.length < 3) return;
          feature = {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [polygon] },
          };
          polygon.forEach((p) => bounds.extend(p as [number, number]));
          hasGeofences = true;
        }

        map.addSource(id, { type: 'geojson', data: feature });
        map.addLayer({
          id: `${id}-fill`,
          type: 'fill',
          source: id,
          paint: {
            'fill-color': gf.color,
            'fill-opacity': isSelected ? 0.3 : 0.15,
          },
        });
        map.addLayer({
          id: `${id}-line`,
          type: 'line',
          source: id,
          paint: {
            'line-color': gf.color,
            'line-width': isSelected ? 3 : 1.5,
            'line-opacity': 0.8,
          },
        });
      });

      if (hasGeofences) {
        map.fitBounds(bounds, { padding: 60, duration: 800 });
      }
    }

    if (map.isStyleLoaded()) {
      drawGeofences();
    } else {
      map.on('load', drawGeofences);
    }
  }, [geofences, selectedId]);

  return <div ref={containerRef} className="w-full h-full" />;
}
