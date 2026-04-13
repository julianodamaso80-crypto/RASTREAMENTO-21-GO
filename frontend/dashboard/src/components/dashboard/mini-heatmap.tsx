'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CARTO_DARK_MATTER_URL, MAP_CENTER } from '@/lib/constants';
import type { VehicleWithTracking } from '@/types/vehicle';

interface MiniHeatmapProps {
  vehicles: VehicleWithTracking[];
}

export function MiniHeatmap({ vehicles }: MiniHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: CARTO_DARK_MATTER_URL,
      center: MAP_CENTER,
      zoom: 10,
      attributionControl: false,
      interactive: false,
    });

    map.on('load', () => {
      map.addSource('vehicles-heat', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'heatmap-layer',
        type: 'heatmap',
        source: 'vehicles-heat',
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': 1.2,
          'heatmap-radius': 28,
          'heatmap-opacity': 0.75,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(16,185,129,0)',
            0.2, 'rgba(16,185,129,0.35)',
            0.4, 'rgba(234,179,8,0.55)',
            0.7, 'rgba(249,115,22,0.75)',
            1, 'rgba(239,68,68,0.9)',
          ],
        },
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      const src = map.getSource('vehicles-heat') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;

      const features = vehicles
        .filter((v) => v.latitude && v.longitude)
        .map((v) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [v.longitude, v.latitude],
          },
          properties: { plate: v.plate },
        }));

      src.setData({ type: 'FeatureCollection', features });

      if (features.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        features.forEach((f) => bounds.extend(f.geometry.coordinates as [number, number]));
        map.fitBounds(bounds, { padding: 40, maxZoom: 12, duration: 500 });
      }
    };

    if (map.loaded()) update();
    else map.once('load', update);
  }, [vehicles]);

  return <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden" />;
}
