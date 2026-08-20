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
import { resolveSatelliteStyle, type SatelliteProvider } from '@/lib/basemap';
import { mapApi } from '@/lib/api';
import type { VehicleWithTracking } from '@/types/vehicle';
import { BasemapToggle } from './basemap-toggle';
import { GoogleMapsAttribution } from './google-attribution';

export interface MapContainerRef {
  flyTo: (
    lng: number,
    lat: number,
    zoom?: number,
    paddingRight?: number,
  ) => void;
  /** Traz o ponto de volta ao quadro se ele saiu — sem mexer no zoom. */
  keepInView: (lng: number, lat: number, paddingRight?: number) => void;
}

interface MapContainerProps {
  vehicles: VehicleWithTracking[];
  onVehicleClick?: (vehicleId: string) => void;
  /** Reposiciona o seletor de mapa quando algo cobre o canto superior direito
   *  — no /mapa é o painel de detalhe do veículo. */
  basemapToggleClassName?: string;
}

/** Duração do deslize do marcador entre duas posições reportadas. */
const ANIM_DURACAO_MS = 1000;
/** Abaixo disso é oscilação de GPS parado — animar só faria o ícone tremer. */
const ANIM_MIN_M = 3;
/** Acima disso não é deslocamento contínuo (reconexão, carga inicial): vai direto. */
const ANIM_MAX_M = 2000;

/** Distância em metros entre duas coordenadas [lng, lat] (Haversine). */
function distanciaMetros(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
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
  function MapContainer({ vehicles, onVehicleClick, basemapToggleClassName }, ref) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    // Animação em curso por veículo: id -> handle do requestAnimationFrame.
    // Ver `animarMarcador()`.
    const animacoesRef = useRef<Map<string, number>>(new Map());
    const [basemap, setBasemap] = useState<BasemapId>('streets');
    // Só preenchido quando o satélite ativo é o do Google — dispara a
    // atribuição obrigatória (logo + copyright do viewport).
    const [satProvider, setSatProvider] = useState<SatelliteProvider | null>(null);
    const [googleMinZoom, setGoogleMinZoom] = useState<number | null>(null);
    // Google só entra do minzoom pra cima — o logo e o copyright dele
    // acompanham isso, senão estaríamos creditando o Google numa imagem Esri.
    const [googleVisible, setGoogleVisible] = useState(false);
    const [googleCopyright, setGoogleCopyright] = useState('');

    useImperativeHandle(ref, () => ({
      flyTo: (lng: number, lat: number, zoom = 15, paddingRight = 0) => {
        // paddingRight compensa o painel de detalhes quando ele está ABERTO
        // (overlay sobre o mapa). Com o painel recolhido vale 0 e o veículo
        // fica no centro real do canvas.
        mapRef.current?.flyTo({
          center: [lng, lat],
          zoom,
          duration: 1000,
          padding: { top: 0, bottom: 0, left: 0, right: paddingRight },
        });
      },

      /**
       * Seguir o veículo sem tomar o mapa de quem está olhando.
       *
       * O seguimento antigo chamava `flyTo` com zoom fixo a cada atualização —
       * e como a lista de veículos inteira é recriada quando QUALQUER um dos 60
       * reporta posição (~0,84 por segundo em 19/08/2026), isso reescrevia o
       * zoom do operador uma vez por segundo e reiniciava uma animação de 1000
       * ms que nunca chegava ao fim. Dava os dois sintomas ao mesmo tempo: o
       * zoom voltava sozinho e o veículo aparecia fora do quadro.
       *
       * Aqui não há zoom no `easeTo` — o MapLibre preserva o atual — e a câmera
       * só se mexe quando o ponto de fato saiu da área visível.
       */
      keepInView: (lng: number, lat: number, paddingRight = 0) => {
        const map = mapRef.current;
        if (!map) return;

        const canvas = map.getCanvas();
        const ponto = map.project([lng, lat]);
        // Margem pra não ficar colado na borda (e pro pin caber inteiro).
        const margem = 80;
        const dentro =
          ponto.x > margem &&
          ponto.x < canvas.clientWidth - paddingRight - margem &&
          ponto.y > margem &&
          ponto.y < canvas.clientHeight - margem;
        if (dentro) return;

        map.easeTo({
          center: [lng, lat],
          duration: 600,
          padding: { top: 0, bottom: 0, left: 0, right: paddingRight },
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

      let cancelled = false;

      const applyStyle = (style: Parameters<typeof map.setStyle>[0]) => {
        if (cancelled) return;

        // Os markers são recriados abaixo; um deslize em curso continuaria
        // escrevendo no marker antigo, que já saiu do mapa.
        animacoesRef.current.forEach((handle) => cancelAnimationFrame(handle));
        animacoesRef.current.clear();

        const snapshot = Array.from(markersRef.current.entries()).map(
          ([id, marker]) => ({ id, lngLat: marker.getLngLat(), el: marker.getElement() }),
        );

        map.setStyle(style);

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
      };

      if (basemap === 'satellite-google') {
        // A sessão do Google é criada no backend; se falhar, resolve() já
        // devolve o Esri e o mapa continua de pé.
        resolveSatelliteStyle().then(({ provider, style, googleMinZoom: minZoom }) => {
          if (cancelled) return;
          setSatProvider(provider);
          setGoogleMinZoom(minZoom);
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

    // ─────────────────────────────────────────────────────────────────
    // Acompanha o zoom pra saber se a camada do Google está em cena.
    // ─────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────
    // Atribuição do viewport (exigida pela política do Google). Segundo a
    // doc, esta chamada não consome cota de tiles. Debounce evita um
    // request por frame durante o pan.
    // ─────────────────────────────────────────────────────────────────
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
    // Desliza o marcador do ponto onde ele está até o ponto novo.
    //
    // O rastreador só reporta de tempos em tempos — a 60 km/h com o TIMER
    // em 10s são ~164 m entre um envio e o outro. Aplicar a coordenada de
    // uma vez fazia o ícone teleportar esse trecho inteiro, e é isso que o
    // operador lê como "o mapa está travado, o carro anda aos pulos".
    //
    // A animação NÃO inventa posição: os dois extremos são pontos que o GPS
    // confirmou, e o percurso dura 1s — o marcador passa a esmagadora maioria
    // do tempo parado sobre a última posição real, não sobre um palpite. Nada
    // de projetar o carro pela rua durante o silêncio do rastreador; isso
    // mandaria a equipe pro lugar errado num roubo.
    // ─────────────────────────────────────────────────────────────────
    const animarMarcador = useCallback(
      (id: string, marker: maplibregl.Marker, destino: [number, number]) => {
        const anterior = animacoesRef.current.get(id);
        if (anterior !== undefined) cancelAnimationFrame(anterior);

        const origem = marker.getLngLat();
        const metros = distanciaMetros(
          [origem.lng, origem.lat],
          destino,
        );

        // Perto demais (oscilação de GPS parado) ou longe demais (primeira
        // carga, reconexão do WebSocket, veículo que ficou horas sem reportar):
        // vai direto. Animar um salto de quilômetros mostraria o carro
        // atravessando a cidade em câmera lenta, longe dos dois pontos reais.
        if (metros < ANIM_MIN_M || metros > ANIM_MAX_M) {
          animacoesRef.current.delete(id);
          marker.setLngLat(destino);
          return;
        }

        const inicio = performance.now();
        const passo = (agora: number) => {
          const t = Math.min(1, (agora - inicio) / ANIM_DURACAO_MS);
          marker.setLngLat([
            origem.lng + (destino[0] - origem.lng) * t,
            origem.lat + (destino[1] - origem.lat) * t,
          ]);
          if (t < 1) {
            animacoesRef.current.set(id, requestAnimationFrame(passo));
            return;
          }
          // Termina SEMPRE cravado na coordenada real, sem resto de float.
          animacoesRef.current.delete(id);
          marker.setLngLat(destino);
        };

        animacoesRef.current.set(id, requestAnimationFrame(passo));
      },
      [],
    );

    // Cancela toda animação pendente quando o mapa é desmontado ou o estilo
    // troca — os markers são recriados nesses dois casos e um rAF órfão
    // continuaria escrevendo em marker que já saiu do mapa.
    useEffect(() => {
      const animacoes = animacoesRef.current;
      return () => {
        animacoes.forEach((handle) => cancelAnimationFrame(handle));
        animacoes.clear();
      };
    }, []);

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
        const isMoving =
          vehicle.displayStatus === 'ignition_on' && vehicle.speed > 0;
        // chave do "visual": só muda quando precisa redesenhar (cor/ícone/pulse)
        const vkey = `${vehicle.displayStatus}|${vehicle.vehicleType}|${isMoving}`;

        if (existing) {
          const el = existing.getElement();
          // A lista de veículos é recriada a cada atualização de QUALQUER um
          // do parque, então este efeito roda ~1x/s por veículo com a mesma
          // coordenada. Sem esta guarda, cada passagem reiniciaria o deslize
          // do zero e o marcador nunca chegaria ao destino.
          const destino = `${lngLat[0]},${lngLat[1]}`;
          if (el.dataset.destino !== destino) {
            el.dataset.destino = destino;
            animarMarcador(vehicle.id, existing, lngLat);
          }
          if (el.dataset.vkey !== vkey) {
            // status/tipo/movimento mudou → redesenha o marcador inteiro
            const newEl = createMarkerElement(vehicle);
            newEl.dataset.vkey = vkey;
            // O destino acompanha o elemento novo, senão a guarda acima
            // reabriria uma animação a cada redesenho de status.
            newEl.dataset.destino = el.dataset.destino ?? '';
            el.replaceWith(newEl);
            (existing as unknown as { _element: HTMLElement })._element = newEl;
          } else {
            // só posição/direção mudou (carro andando) → gira a img no lugar,
            // sem recriar (evita o "pisca" do desenho a cada atualização)
            const img = el.querySelector('img');
            if (img) {
              (img as HTMLElement).style.transform = `rotate(${vehicle.course}deg)`;
            }
          }
        } else {
          const el = createMarkerElement(vehicle);
          el.dataset.vkey = vkey;
          el.dataset.destino = `${lngLat[0]},${lngLat[1]}`;
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat(lngLat)
            .addTo(map);
          markersRef.current.set(vehicle.id, marker);
        }
      }

      // Remove markers que sumiram da lista
      markersRef.current.forEach((marker, id) => {
        if (!currentIds.has(id)) {
          const anim = animacoesRef.current.get(id);
          if (anim !== undefined) {
            cancelAnimationFrame(anim);
            animacoesRef.current.delete(id);
          }
          marker.remove();
          markersRef.current.delete(id);
        }
      });
    }, [vehicles, createMarkerElement, animarMarcador]);

    return (
      <div className="relative w-full h-full">
        <div ref={mapContainerRef} className="w-full h-full" />
        <BasemapToggle
          current={basemap}
          onChange={setBasemap}
          className={basemapToggleClassName}
        />
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
  },
);

export default MapContainer;
