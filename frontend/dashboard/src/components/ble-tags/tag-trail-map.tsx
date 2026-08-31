'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASEMAPS, MAP_CENTER, type BasemapId } from '@/lib/constants';
import { resolveSatelliteStyle, type SatelliteProvider } from '@/lib/basemap';
import { mapApi } from '@/lib/api';
import { BasemapToggle } from '@/components/map/basemap-toggle';
import { GoogleMapsAttribution } from '@/components/map/google-attribution';
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
 *
 * A escolha de mapa (Padrão / Satélite grátis / Satélite Google) é a mesma do
 * mapa de rastreador, pelo mesmo componente: quem procura um veículo precisa
 * ver o telhado e o pátio, e aprender dois seletores diferentes na mesma
 * plataforma é atrito à toa.
 */

/** Cor da marca (laranja 21Go) — TAG nunca usa o verde do rastreador. */
const COR_TRILHA = '#f2911d';
const COR_PONTO = '#c0700a';

/** Ids das camadas que este mapa cria. Trocar de basemap apaga todas. */
const CAMADAS = ['trilha-linha', 'precisao-preenchimento'] as const;
const FONTES = ['trilha', 'precisao'] as const;

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

  const [basemap, setBasemap] = useState<BasemapId>('streets');
  const [satProvider, setSatProvider] = useState<SatelliteProvider | null>(null);
  const [googleMinZoom, setGoogleMinZoom] = useState<number | null>(null);
  const [googleVisible, setGoogleVisible] = useState(false);
  const [googleCopyright, setGoogleCopyright] = useState('');

  /**
   * Enquadrar é gesto de chegada, não de troca de mapa. Sem esta trava, mudar
   * para satélite jogaria a câmera de volta ao enquadramento inicial e o
   * operador perderia o lugar que estava olhando.
   */
  const jaEnquadrouRef = useRef(false);

  /**
   * `setStyle` descarta TODAS as sources e layers do mapa — inclusive as
   * nossas. Diferente do mapa de rastreador, que só tem marcador (nó DOM, que
   * sobrevive à troca), aqui a trilha e os círculos de precisão precisam ser
   * redesenhados depois de cada troca de basemap. Sem isto, escolher satélite
   * apagaria o rastro e sobrariam só os pontos soltos.
   */
  const redesenharCamadasRef = useRef<() => void>(() => {});

  const desenharCamadas = useCallback(
    (map: maplibregl.Map, todos: PontoTrilha[]) => {
      for (const id of CAMADAS) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of FONTES) {
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
    },
    [segmentos],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // Mesmo mapa inicial do rastreador: o operador troca de tela e encontra
      // a mesma base, em vez de um mapa escuro que parece outro sistema.
      style: BASEMAPS[0].url,
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
      jaEnquadrouRef.current = false;
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // Troca de basemap. Mesma lógica do mapa de rastreador, com um passo a
  // mais: redesenhar as camadas depois que o estilo novo terminar de carregar.
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const def = BASEMAPS.find((b) => b.id === basemap);
    if (!def || !def.url) return;

    let cancelado = false;

    const aplicar = (style: Parameters<typeof map.setStyle>[0]) => {
      if (cancelado) return;
      map.setStyle(style);
      // `once` e não `on`: cada troca registra o seu próprio redesenho, e o
      // ouvinte morre depois de disparar em vez de empilhar.
      map.once('styledata', () => {
        if (!cancelado) redesenharCamadasRef.current();
      });
    };

    if (basemap === 'satellite-google') {
      // A sessão do Google é criada no backend; se falhar, resolve() já
      // devolve o Esri e o mapa continua de pé.
      resolveSatelliteStyle().then(({ provider, style, googleMinZoom: minZoom }) => {
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
  }, [basemap]);

  // ─────────────────────────────────────────────────────────────────
  // Acompanha o zoom pra saber se a camada do Google está em cena.
  // ─────────────────────────────────────────────────────────────────
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
  }, [googleMinZoom]);

  // ─────────────────────────────────────────────────────────────────
  // Atribuição do viewport, exigida pela política do Google. Segundo a doc,
  // esta chamada não consome cota de tiles. O debounce evita um request por
  // frame durante o arrasto.
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !googleVisible) return;

    let timer: ReturnType<typeof setTimeout>;

    const atualizar = () => {
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

    atualizar();
    map.on('moveend', atualizar);

    return () => {
      clearTimeout(timer);
      map.off('moveend', atualizar);
    };
  }, [googleVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const todos: PontoTrilha[] = segmentos.flatMap((s) => s.pontos);

    redesenharCamadasRef.current = () => {
      const atual = mapRef.current;
      if (atual) desenharCamadas(atual, todos);
    };

    function desenhar() {
      if (!map) return;

      // Marcadores são donos do próprio ciclo de vida: removê-los pela
      // referência (e não varrendo o DOM) evita apagar marcador de outro mapa.
      marcadoresRef.current.forEach((m) => m.remove());
      marcadoresRef.current = [];

      desenharCamadas(map, todos);

      if (todos.length === 0) return;

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

      if (!jaEnquadrouRef.current) {
        const limites = new maplibregl.LngLatBounds();
        todos.forEach((p) => limites.extend([p.lng, p.lat]));
        map.fitBounds(limites, { padding: 60, duration: 800, maxZoom: 16 });
        jaEnquadrouRef.current = true;
      }
    }

    if (map.isStyleLoaded()) desenhar();
    else map.once('load', desenhar);
  }, [segmentos, desenharCamadas]);

  return (
    <div className="relative h-full w-full min-h-[360px]">
      <div ref={containerRef} className="h-full w-full overflow-hidden rounded-lg" />

      <BasemapToggle current={basemap} onChange={setBasemap} />

      {satProvider === 'google' && googleVisible && (
        <GoogleMapsAttribution copyright={googleCopyright} />
      )}
      {basemap === 'satellite-google' && satProvider === 'google' && !googleVisible && (
        // Sem isto o operador escolhe "Satélite Google", vê a mesma imagem
        // de antes (porque de longe o Esri já basta) e conclui que o botão
        // não funcionou.
        <div className="pointer-events-none absolute bottom-8 left-2 z-10 rounded-md bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow-md backdrop-blur-md">
          Aproxime o zoom para a imagem em alta do Google
        </div>
      )}
    </div>
  );
}
