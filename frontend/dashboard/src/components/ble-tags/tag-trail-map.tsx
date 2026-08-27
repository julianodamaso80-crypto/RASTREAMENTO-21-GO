'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CARTO_DARK_MATTER_URL, MAP_CENTER } from '@/lib/constants';
import type { SegmentoTrilha, PontoTrilha } from '@/types/ble-tag';

/**
 * Rastro da TAG no mapa.
 *
 * A TAG não anda reportando: ela é vista quando alguém passa perto dela. Por
 * isso o desenho aqui é deliberadamente diferente do mapa de rastreador —
 * cada escolha visual existe para o operador não confundir uma coisa com a
 * outra:
 *
 *  - linha TRACEJADA, nunca sólida: o trecho entre dois avistamentos é
 *    presumido, não observado. Sólido fica reservado para GPS.
 *  - um LineString por segmento: quando há buraco de sinal a linha QUEBRA.
 *    Costurar os dois lados afirmaria um trajeto que ninguém viu.
 *  - círculo do raio de precisão real embaixo de cada ponto: a rede Find My
 *    diz "em algum lugar dentro de X metros", e é isso que o mapa mostra.
 *  - todo ponto carrega os dois horários (quando foi vista, quando chegou
 *    até nós).
 *
 * Nada de quilometragem: somar as retas entre avistamentos não é a distância
 * que o veículo percorreu, e publicar esse número seria inventar dado.
 */

/** Cor da marca (laranja 21Go) — TAG nunca usa o verde do rastreador. */
const COR_TRILHA = '#f2911d';
const COR_PONTO = '#c0700a';

/**
 * Anel que aproxima um círculo de raio em METROS, para virar polígono GeoJSON.
 *
 * `circle-radius` do MapLibre é em pixels e encolheria o raio de precisão a
 * cada zoom out, mentindo sobre a incerteza. Polígono em coordenadas mantém a
 * escala real do terreno.
 */
export function metrosParaCirculo(
  lat: number,
  lng: number,
  raioM: number,
  n = 32,
): [number, number][] {
  const anel: [number, number][] = [];
  const dLat = raioM / 111320;
  const dLng = raioM / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    anel.push([lng + dLng * Math.sin(a), lat + dLat * Math.cos(a)]);
  }
  return anel;
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function diaMes(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

/** "12 min", "3h" — o atraso do avistamento em linguagem de gente. */
function atrasoLegivel(segundos: number): string {
  const min = Math.round(segundos / 60);
  if (min < 1) return 'na hora';
  if (min < 60) return `${min} min depois`;
  return `${Math.round(min / 60)}h depois`;
}

interface TagTrailMapProps {
  segmentos: SegmentoTrilha[];
}

export function TagTrailMap({ segmentos }: TagTrailMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const marcadoresRef = useRef<maplibregl.Marker[]>([]);

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
      marcadoresRef.current = [];
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const todos: PontoTrilha[] = segmentos.flatMap((s) => s.pontos);

    function desenhar() {
      if (!map) return;

      // Marcadores são donos do próprio ciclo de vida: removê-los pela
      // referência (e não varrendo o DOM) evita apagar marcador de outro mapa.
      marcadoresRef.current.forEach((m) => m.remove());
      marcadoresRef.current = [];

      for (const id of ['trilha-linha', 'precisao-preenchimento']) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of ['trilha', 'precisao']) {
        if (map.getSource(id)) map.removeSource(id);
      }

      if (todos.length === 0) return;

      // Círculos de precisão primeiro, para ficarem por baixo da linha.
      map.addSource('precisao', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: todos.map((p) => ({
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'Polygon' as const,
              coordinates: [metrosParaCirculo(p.lat, p.lng, p.accuracy ?? 60)],
            },
          })),
        },
      });
      map.addLayer({
        id: 'precisao-preenchimento',
        type: 'fill',
        source: 'precisao',
        paint: { 'fill-color': COR_TRILHA, 'fill-opacity': 0.08 },
      });

      // Uma linha por segmento. Segmento de um ponto só não vira linha.
      map.addSource('trilha', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: segmentos
            .filter((s) => s.pontos.length >= 2)
            .map((s) => ({
              type: 'Feature' as const,
              properties: {},
              geometry: {
                type: 'LineString' as const,
                coordinates: s.pontos.map(
                  (p) => [p.lng, p.lat] as [number, number],
                ),
              },
            })),
        },
      });
      map.addLayer({
        id: 'trilha-linha',
        type: 'line',
        source: 'trilha',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COR_TRILHA,
          'line-width': 2.5,
          'line-dasharray': [2, 2],
          'line-opacity': 0.9,
        },
      });

      todos.forEach((p, i) => {
        const ehUltimo = i === todos.length - 1;
        const lado = ehUltimo ? 16 : 9;
        const el = document.createElement('div');
        el.className = 'tag-sighting-marker';
        // Sem `position` aqui: o MapLibre posiciona pela classe dele. Definir
        // position inline foi o bug que empilhava marcador fora da coordenada
        // (ver scripts/diagnostics/marcador-no-lugar.js).
        el.style.cssText = 'border-radius:50%;border:2px solid #ffffff;box-sizing:border-box;cursor:pointer;';
        el.style.width = `${lado}px`;
        el.style.height = `${lado}px`;
        el.style.background = ehUltimo ? COR_TRILHA : COR_PONTO;

        const popup = new maplibregl.Popup({ offset: 12, closeButton: false })
          .setHTML(
            `<div style="font-size:12px;line-height:1.5;color:#0f172a">
               <b>${ehUltimo ? 'Último avistamento' : 'Avistamento'}</b><br>
               Vista ${diaMes(p.seenAt)} às ${hhmm(p.seenAt)}<br>
               <span style="opacity:.75">registrada ${atrasoLegivel(p.latenciaSeg)}</span>
               ${p.accuracy ? `<br><span style="opacity:.75">precisão ~${p.accuracy} m</span>` : ''}
             </div>`,
          );

        const marcador = new maplibregl.Marker({ element: el })
          .setLngLat([p.lng, p.lat])
          .setPopup(popup)
          .addTo(map);
        marcadoresRef.current.push(marcador);
      });

      const limites = new maplibregl.LngLatBounds();
      todos.forEach((p) => limites.extend([p.lng, p.lat]));
      map.fitBounds(limites, { padding: 60, duration: 800, maxZoom: 16 });
    }

    if (map.isStyleLoaded()) desenhar();
    else map.once('load', desenhar);
  }, [segmentos]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full min-h-[360px] overflow-hidden rounded-lg"
    />
  );
}
