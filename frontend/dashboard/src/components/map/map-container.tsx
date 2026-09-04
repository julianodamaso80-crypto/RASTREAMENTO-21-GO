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
  /** Enquadra vários pontos de uma vez — os marcados vistos juntos. */
  fitTo: (pontos: [number, number][], paddingRight?: number) => void;
}

interface MapContainerProps {
  vehicles: VehicleWithTracking[];
  onVehicleClick?: (vehicleId: string) => void;
  /** Reposiciona o seletor de mapa quando algo cobre o canto superior direito
   *  — no /mapa é o painel de detalhe do veículo. */
  basemapToggleClassName?: string;
  /** Veículos marcados na lista/painel, na ordem em que foram marcados.
   *
   *  O marcador de cada um ganha etiqueta fixa — sem depender do hover, que
   *  some assim que o operador tira o mouse e deixa o pin anônimo no meio dos
   *  outros. Com UM marcado a etiqueta traz placa e estado da ignição; com
   *  vários ela encolhe pra "① ABC1D23", porque etiqueta de duas linhas em
   *  quatro pinos na mesma rua vira mancha ilegível. O número é o mesmo da
   *  linha no painel de marcados: é ele que diz qual pino é qual. */
  selectedIds?: string[];
  /** Avisa que o mapa já existe e aceita comandos de câmera. Quem chega com um
   *  veículo pra abrir (ex.: "Abrir no mapa") precisa disso: o componente é
   *  carregado sob demanda e o `flyTo` disparado antes disso ia pro vazio. */
  onReady?: () => void;
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
 * Texto do estado que vai na etiqueta do veículo selecionado.
 *
 * Com o rastreador mudo a ignição guardada é a da última posição recebida —
 * afirmar "desligado" ali seria dar como fato um dado velho.
 */
function rotuloEstado(vehicle: VehicleWithTracking): string {
  if (vehicle.displayStatus === 'offline') return 'Sem sinal do rastreador';
  const ignicao = vehicle.ignition ? 'Ignição ligada' : 'Ignição desligada';
  return vehicle.displayStatus === 'alert'
    ? `Bloqueado · ${ignicao}`
    : ignicao;
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
  function MapContainer(
    {
      vehicles,
      onVehicleClick,
      basemapToggleClassName,
      onReady,
      selectedIds,
    },
    ref,
  ) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    // Guardado em ref pra não entrar nas dependências do efeito que cria o
    // mapa: um callback inline recriaria o mapa inteiro a cada renderização.
    const onReadyRef = useRef(onReady);
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    // Animação em curso por veículo: id -> handle do requestAnimationFrame.
    // Ver `animarMarcador()`.
    const animacoesRef = useRef<Map<string, number>>(new Map());
    // Última coordenada que o rastreador reportou por veículo — o ponto onde o
    // marcador tem que estar. Fica em ref, e não num `data-` do elemento, para
    // que ele descreva SEMPRE a coordenada real: um atributo no DOM podia
    // continuar afirmando um destino que o marcador já não ocupava, e a guarda
    // de "coordenada repetida" então travava o marcador no lugar errado.
    const destinosRef = useRef<Map<string, [number, number]>>(new Map());
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

      /**
       * Enquadra todos os pontos marcados de uma vez.
       *
       * Com um ponto só, `fitBounds` levaria ao zoom máximo do mapa; aí o
       * comportamento certo é o mesmo de sempre — centraliza no zoom de leitura
       * de rua. `maxZoom` cobre também o caso de dois marcados no mesmo pátio.
       */
      fitTo: (pontos, paddingRight = 0) => {
        const map = mapRef.current;
        if (!map || pontos.length === 0) return;
        const padding = { top: 90, bottom: 90, left: 90, right: paddingRight + 90 };
        if (pontos.length === 1) {
          map.easeTo({ center: pontos[0], zoom: 15, duration: 800, padding });
          return;
        }
        const bounds = new maplibregl.LngLatBounds();
        pontos.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds, { padding, maxZoom: 16, duration: 800 });
      },
    }));

    // ─────────────────────────────────────────────────────────────────
    // Inicializa mapa (uma vez só — não depende de `basemap`)
    // ─────────────────────────────────────────────────────────────────
    useEffect(() => {
      onReadyRef.current = onReady;
    }, [onReady]);

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
      map.once('load', () => onReadyRef.current?.());

      return () => {
        markersRef.current.forEach((m) => m.remove());
        markersRef.current.clear();
        map.remove();
        mapRef.current = null;
      };
    }, []);

    // ─────────────────────────────────────────────────────────────────
    // Troca de basemap (Padrão ↔ Satélite).
    //
    // `setStyle` NÃO mexe nos markers: eles são nós DOM do canvas-container,
    // não fazem parte do style. Medido no MapLibre 5.21.1 em 25/08/2026 — o
    // marcador continua no pixel exato depois da troca.
    //
    // Existia aqui um re-attach manual no `styledata` que tirava e recriava
    // cada marker na coordenada capturada num snapshot. Além de desnecessário,
    // ele congelava o marcador: o snapshot era tirado no meio de um deslize, e
    // como a coordenada reportada não tinha mudado, nada o trazia de volta pro
    // ponto real. Trocar de mapa deslocava o veículo — foi removido.
    // ─────────────────────────────────────────────────────────────────
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      const def = BASEMAPS.find((b) => b.id === basemap);
      if (!def || !def.url) return;

      let cancelled = false;

      const applyStyle = (style: Parameters<typeof map.setStyle>[0]) => {
        if (cancelled) return;
        map.setStyle(style);
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
    // Desenha o conteúdo do marker DENTRO do nó que o MapLibre controla.
    //
    // Sempre repintar, nunca trocar o nó: quem é dono da posição na tela é o
    // MapLibre, que escreve `transform` no elemento que recebeu no construtor
    // e marca ele com a classe `maplibregl-marker`. Substituir esse nó por
    // outro (o antigo `el.replaceWith(novo)` + `marker._element = novo`)
    // entregava ao MapLibre um elemento sem a classe e sem transform: o
    // marcador ia pro canto superior esquerdo do mapa — 718 px medidos, ~3 km —
    // e ficava lá PERMANENTEMENTE, porque sem a classe nenhum reposicionamento
    // posterior o traz de volta. Ver scripts/diagnostics/marcador-no-lugar.js.
    // ─────────────────────────────────────────────────────────────────
    const pintarMarcador = useCallback(
      (
        el: HTMLElement,
        vehicle: VehicleWithTracking,
        selecionado: boolean,
        /** Posição do veículo entre os marcados (1, 2, 3…) quando são vários. */
        ordem: number | null,
      ) => {
        const color = STATUS_COLORS[vehicle.displayStatus];
        // Pulse só quando carro REALMENTE está se movendo (motor ligado +
        // velocidade > 0). Não pulsa só por ignição ligada parado.
        const isMoving =
          vehicle.displayStatus === 'ignition_on' && vehicle.speed > 0;

        // Desenho REALISTA do veículo (carro/moto vista de cima) girando na
        // direção real, com anel colorido por status pra leitura rápida e
        // sombra pra destacar em qualquer basemap (satélite/streets/dark).
        const icon = VEHICLE_ICONS[vehicle.vehicleType] ?? VEHICLE_ICONS.CAR;
        // O selecionado sobe acima dos vizinhos: com dois pins encostados, a
        // etiqueta dele ficava atrás do ícone do outro.
        el.style.zIndex = selecionado ? '5' : '';
        el.innerHTML = `
          ${isMoving ? `<div class="vehicle-pulse" style="position:absolute;width:60px;height:60px;border-radius:50%;background:${color};opacity:0.3;top:50%;left:50%;transform:translate(-50%,-50%);"></div>` : ''}
          <div style="width:54px;height:54px;position:relative;z-index:1;display:flex;align-items:center;justify-content:center;">
            ${selecionado ? `<div style="position:absolute;width:62px;height:62px;border-radius:50%;border:2px solid rgba(255,255,255,0.9);box-shadow:0 0 0 2px ${color},0 2px 10px rgba(0,0,0,0.6);"></div>` : ''}
            <div style="position:absolute;width:50px;height:50px;border-radius:50%;border:3px solid ${color};background:rgba(15,23,42,0.25);box-shadow:0 0 0 1px rgba(0,0,0,0.35),0 2px 8px rgba(0,0,0,0.55);"></div>
            <img src="${icon}" width="44" height="44" alt="" draggable="false"
              style="position:relative;z-index:2;transform:rotate(${vehicle.course}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.7));pointer-events:none;" />
          </div>
        `;

        // Tooltip ao passar o mouse. É filho do nó (o `innerHTML` acima já
        // limpou o tooltip da pintura anterior), então acompanha o marcador
        // sem participar do posicionamento dele.
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

        // Etiqueta fixa do selecionado: placa e ignição legíveis sem hover.
        // Vai ABAIXO do ícone para não brigar com o tooltip, que ocupa o
        // espaço de cima.
        if (selecionado) {
          const etiqueta = document.createElement('div');
          etiqueta.style.cssText = `position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:4px;padding:4px 9px;background:rgba(15,23,42,0.95);border:1px solid ${color};border-radius:6px;white-space:nowrap;font-size:11px;line-height:1.35;color:#e2e8f0;text-align:center;z-index:9;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,0.55);backdrop-filter:blur(8px);`;
          etiqueta.innerHTML =
            ordem === null
              ? `
            <div style="font-weight:700;letter-spacing:0.6px;">${vehicle.plate}</div>
            <div style="display:flex;align-items:center;justify-content:center;gap:4px;color:${color};font-weight:600;">
              <span style="width:6px;height:6px;border-radius:50%;background:${color};"></span>${rotuloEstado(vehicle)}
            </div>
          `
              : `
            <div style="display:flex;align-items:center;gap:5px;font-weight:700;letter-spacing:0.6px;">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:${color};color:#0f172a;font-size:10px;">${ordem}</span>${vehicle.plate}
            </div>
          `;
          el.appendChild(etiqueta);
        }

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
      },
      [onVehicleClick],
    );

    /**
     * Cria o nó que será entregue ao MapLibre.
     *
     * NÃO declarar `position` aqui. A classe `.maplibregl-marker` que o
     * MapLibre adiciona traz `position:absolute; top:0; left:0`, e é a partir
     * desse canto que ele desloca o marcador com `transform`. Um
     * `position:relative` inline vence essa classe (estilo inline > regra de
     * classe), o marcador cai no FLUXO do canvas-container e cada um passa a
     * empilhar 54 px — a altura do ícone — abaixo do anterior: medido em
     * 25/08/2026, o 1º ficava certo, o 2º errava 239 m, o 8º errava 1 665 m, e
     * com o parque inteiro o erro passava de 18 000 px, ou seja, o veículo
     * simplesmente não aparecia no mapa.
     *
     * width/height fixos continuam necessários: sem eles o div vira block e
     * estica pra largura inteira do mapa.
     */
    const createMarkerElement = useCallback(
      (
        vehicle: VehicleWithTracking,
        selecionado: boolean,
        ordem: number | null,
      ) => {
        const el = document.createElement('div');
        el.className = 'vehicle-marker-container';
        el.style.cssText =
          'cursor:pointer;width:54px;height:54px;display:flex;align-items:center;justify-content:center;';
        pintarMarcador(el, vehicle, selecionado, ordem);
        return el;
      },
      [pintarMarcador],
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
      // Ordem em que cada marcado entrou — é o número da etiqueta e o da linha
      // no painel. `null` quando há um só: aí a etiqueta volta a ser a de
      // sempre (placa + estado da ignição), sem número pra decorar.
      const ordemPorId = new Map<string, number>();
      if (selectedIds && selectedIds.length > 1) {
        selectedIds.forEach((id, i) => ordemPorId.set(id, i + 1));
      }

      for (const vehicle of vehicles) {
        if (!vehicle.latitude || !vehicle.longitude) continue;
        currentIds.add(vehicle.id);

        const existing = markersRef.current.get(vehicle.id);
        const lngLat: [number, number] = [vehicle.longitude, vehicle.latitude];
        const isMoving =
          vehicle.displayStatus === 'ignition_on' && vehicle.speed > 0;
        const selecionado = selectedIds?.includes(vehicle.id) ?? false;
        const ordem = ordemPorId.get(vehicle.id) ?? null;
        // chave do "visual": só muda quando precisa redesenhar (cor/ícone/
        // pulse/seleção). A ignição entra aqui porque a etiqueta do
        // selecionado a exibe — sem isso ela ficaria mostrando "Ignição
        // ligada" depois do motorista desligar o carro.
        // A ordem entra na chave: marcar/desmarcar um vizinho renumera os
        // outros, e sem isso a etiqueta continuaria mostrando o número velho.
        const vkey = `${vehicle.displayStatus}|${vehicle.vehicleType}|${isMoving}|${selecionado}|${ordem}|${vehicle.ignition}`;

        if (existing) {
          const el = existing.getElement();
          // A lista de veículos é recriada a cada atualização de QUALQUER um
          // do parque, então este efeito roda ~1x/s por veículo com a mesma
          // coordenada. Sem esta guarda, cada passagem reiniciaria o deslize
          // do zero e o marcador nunca chegaria ao destino.
          const destinoAtual = destinosRef.current.get(vehicle.id);
          const coordenadaNova =
            !destinoAtual ||
            destinoAtual[0] !== lngLat[0] ||
            destinoAtual[1] !== lngLat[1];

          if (coordenadaNova) {
            destinosRef.current.set(vehicle.id, lngLat);
            animarMarcador(vehicle.id, existing, lngLat);
          } else if (!animacoesRef.current.has(vehicle.id)) {
            // Rede de segurança: coordenada é a mesma e não há deslize em
            // curso, então o marcador TEM que estar exatamente sobre ela. Se
            // não estiver, alguma coisa o desposicionou — crava de volta agora,
            // no máximo um segundo depois. Um marcador fora do lugar é o mapa
            // mentindo onde o veículo está; não pode sobreviver a um tick.
            const onde = existing.getLngLat();
            if (onde.lng !== lngLat[0] || onde.lat !== lngLat[1]) {
              existing.setLngLat(lngLat);
            }
          }

          if (el.dataset.vkey !== vkey) {
            // status/tipo/movimento mudou → repinta o conteúdo DENTRO do mesmo
            // nó. Trocar o nó por outro tirava dele a classe que o MapLibre usa
            // pra posicionar e mandava o marcador pro canto do mapa de vez.
            pintarMarcador(el, vehicle, selecionado, ordem);
            el.dataset.vkey = vkey;
          } else {
            // só posição/direção mudou (carro andando) → gira a img no lugar,
            // sem repintar (evita o "pisca" do desenho a cada atualização)
            const img = el.querySelector('img');
            if (img) {
              (img as HTMLElement).style.transform = `rotate(${vehicle.course}deg)`;
            }
          }
        } else {
          const el = createMarkerElement(vehicle, selecionado, ordem);
          el.dataset.vkey = vkey;
          destinosRef.current.set(vehicle.id, lngLat);
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
          destinosRef.current.delete(id);
        }
      });
    }, [
      vehicles,
      selectedIds,
      createMarkerElement,
      pintarMarcador,
      animarMarcador,
    ]);

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
