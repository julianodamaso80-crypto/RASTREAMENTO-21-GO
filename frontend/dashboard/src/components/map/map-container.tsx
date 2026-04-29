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

const SOURCE_ID = 'vehicles-source';
const CLUSTER_LAYER_ID = 'vehicle-clusters';
const CLUSTER_COUNT_LAYER_ID = 'vehicle-cluster-count';
const UNCLUSTERED_LAYER_ID = 'vehicle-unclustered';

const MapContainer = forwardRef<MapContainerRef, MapContainerProps>(
  function MapContainer({ vehicles, onVehicleClick }, ref) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    // Markers DOM apenas pros pontos NÃO clusterizados (mantém visual de seta direcional).
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    // Cache do dataset de vehicles pra reagir em sourcedata sem recriar GeoJSON
    const vehiclesByIdRef = useRef<Map<string, VehicleWithTracking>>(new Map());
    const sourceLoadedRef = useRef(false);

    useImperativeHandle(ref, () => ({
      flyTo: (lng: number, lat: number, zoom = 15) => {
        mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1000 });
      },
    }));

    // ─────────────────────────────────────────────────────────────────
    // 1. Inicializa mapa + GeoJSON source com clustering
    // ─────────────────────────────────────────────────────────────────
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

      map.on('load', () => {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterMaxZoom: 14, // acima desse zoom, expande tudo
          clusterRadius: 50, // px no viewport
        });

        // Círculo do cluster
        map.addLayer({
          id: CLUSTER_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': [
              'step',
              ['get', 'point_count'],
              '#10b981', // <10 pontos
              10, '#f59e0b', // 10-50
              50, '#ef4444', // 50+
            ],
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              18,
              10, 24,
              50, 32,
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': 'rgba(255,255,255,0.5)',
          },
        });

        // Número dentro do cluster
        map.addLayer({
          id: CLUSTER_COUNT_LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size': 14,
          },
          paint: {
            'text-color': '#ffffff',
          },
        });

        // Layer invisível pros pontos NÃO clusterizados — usado só como
        // fonte de eventos. O visual real é DOM Marker (seta direcional).
        map.addLayer({
          id: UNCLUSTERED_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-radius': 0,
            'circle-opacity': 0,
          },
        });

        // Click no cluster: expand zoom
        map.on('click', CLUSTER_LAYER_ID, (e) => {
          const features = map.queryRenderedFeatures(e.point, {
            layers: [CLUSTER_LAYER_ID],
          });
          const feature = features[0];
          if (!feature) return;
          const clusterId = feature.properties?.cluster_id;
          const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
          source.getClusterExpansionZoom(clusterId).then((zoom) => {
            const geom = feature.geometry as unknown as {
              coordinates: [number, number];
            };
            map.easeTo({
              center: geom.coordinates,
              zoom,
              duration: 600,
            });
          });
        });

        map.on('mouseenter', CLUSTER_LAYER_ID, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', CLUSTER_LAYER_ID, () => {
          map.getCanvas().style.cursor = '';
        });

        // Mantém os DOM markers em sync com features unclustered visíveis no viewport
        map.on('moveend', syncDomMarkers);
        map.on('zoomend', syncDomMarkers);
        map.on('sourcedata', (ev) => {
          if (ev.sourceId === SOURCE_ID && ev.isSourceLoaded) {
            sourceLoadedRef.current = true;
            syncDomMarkers();
          }
        });
      });

      mapRef.current = map;

      return () => {
        markersRef.current.forEach((m) => m.remove());
        markersRef.current.clear();
        map.remove();
        mapRef.current = null;
        sourceLoadedRef.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ─────────────────────────────────────────────────────────────────
    // 2. Cria DOM marker (seta direcional) para 1 vehicle
    // ─────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────
    // 3. Sincroniza DOM markers com features unclustered visíveis
    // ─────────────────────────────────────────────────────────────────
    const syncDomMarkers = useCallback(() => {
      const map = mapRef.current;
      if (!map || !sourceLoadedRef.current) return;

      const features = map.querySourceFeatures(SOURCE_ID, {
        filter: ['!', ['has', 'point_count']],
      });

      const visibleIds = new Set<string>();

      for (const feature of features) {
        const id = feature.properties?.vehicleId as string | undefined;
        if (!id) continue;
        const vehicle = vehiclesByIdRef.current.get(id);
        if (!vehicle) continue;

        visibleIds.add(id);
        const existing = markersRef.current.get(id);
        const lngLat: [number, number] = [vehicle.longitude, vehicle.latitude];

        if (existing) {
          existing.setLngLat(lngLat);
          // Re-render visual se status/course mudou
          const newEl = createMarkerElement(vehicle);
          existing.getElement().replaceWith(newEl);
          (existing as unknown as { _element: HTMLElement })._element = newEl;
        } else {
          const el = createMarkerElement(vehicle);
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat(lngLat)
            .addTo(map);
          markersRef.current.set(id, marker);
        }
      }

      // Remove DOM markers que agora estão dentro de cluster ou fora do viewport
      markersRef.current.forEach((marker, id) => {
        if (!visibleIds.has(id)) {
          marker.remove();
          markersRef.current.delete(id);
        }
      });
    }, [createMarkerElement]);

    // ─────────────────────────────────────────────────────────────────
    // 4. Atualiza GeoJSON source quando lista de vehicles muda
    // ─────────────────────────────────────────────────────────────────
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      // Atualiza cache id → vehicle pro syncDomMarkers
      vehiclesByIdRef.current.clear();
      for (const v of vehicles) {
        if (!v.latitude || !v.longitude) continue;
        vehiclesByIdRef.current.set(v.id, v);
      }

      const features = vehicles
        .filter((v) => v.latitude && v.longitude)
        .map((v) => ({
          type: 'Feature' as const,
          properties: { vehicleId: v.id },
          geometry: {
            type: 'Point' as const,
            coordinates: [v.longitude, v.latitude] as [number, number],
          },
        }));

      const source = map.getSource(SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (source) {
        source.setData({ type: 'FeatureCollection', features });
      } else {
        // Source ainda não carregou (load event não disparou). Quando carregar,
        // sourcedata vai disparar syncDomMarkers naturalmente.
      }
    }, [vehicles]);

    return <div ref={mapContainerRef} className="w-full h-full" />;
  },
);

export default MapContainer;
