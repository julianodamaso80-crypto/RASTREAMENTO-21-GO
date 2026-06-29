import type { StyleSpecification } from 'maplibre-gl';
import type { DisplayStatus, VehicleType } from '@/types/vehicle';

export const MAP_CENTER: [number, number] = [-49.2643, -16.6869]; // Goiânia
export const MAP_ZOOM = 12;

export const CARTO_DARK_MATTER_URL =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Estilo claro tipo Google Maps — colorido, ruas claras, prédios cinza,
// parques verdes, água azul. Free, sem API key. Ideal pra cliente final.
export const CARTO_VOYAGER_URL =
  'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

// MapTiler — só ativa quando NEXT_PUBLIC_MAPTILER_KEY estiver setado.
// Tier free: 100k tile requests/mês. Plano Starter: $25/mês (500k req).
// https://www.maptiler.com/cloud/plans/
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? '';

export const HAS_MAPTILER = MAPTILER_KEY.length > 0;

const maptilerStyle = (style: string) =>
  `https://api.maptiler.com/maps/${style}/style.json?key=${MAPTILER_KEY}`;

export type BasemapId = 'streets' | 'satellite';

interface BasemapDef {
  id: BasemapId;
  label: string;
  // string = URL de style; objeto = StyleSpecification inline (satélite Esri).
  url: string | StyleSpecification;
  /** Quando true, só carrega se HAS_MAPTILER. */
  requiresKey: boolean;
}

// Satélite Esri World Imagery — nítido (estilo Google), grátis e SEM API key.
// Camada de imagery + overlay de ruas/labels (World_Transportation) = "híbrido"
// igual ao satélite do Google Maps. Substitui o MapTiler hybrid, que era menos nítido.
const ESRI_SATELLITE_STYLE = {
  version: 8,
  sources: {
    'esri-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
    'esri-labels': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
    },
  },
  layers: [
    { id: 'esri-imagery', type: 'raster', source: 'esri-imagery' },
    { id: 'esri-labels', type: 'raster', source: 'esri-labels' },
  ],
} as StyleSpecification;

export const BASEMAPS: BasemapDef[] = [
  {
    id: 'streets',
    label: 'Padrão',
    // Se tem chave, usa MapTiler Streets v2 (mais detalhado que CARTO).
    // Sem chave, cai pro CARTO Voyager — mantém comportamento atual.
    url: HAS_MAPTILER ? maptilerStyle('streets-v2') : CARTO_VOYAGER_URL,
    requiresKey: false,
  },
  {
    id: 'satellite',
    label: 'Satélite',
    // Esri World Imagery + ruas/labels — nítido tipo Google, grátis e sem key.
    url: ESRI_SATELLITE_STYLE,
    requiresKey: false,
  },
];

// Estilo padrão usado no /mapa ao primeiro load.
export const MAP_STYLE_URL = BASEMAPS[0].url;

// Desenho realista (vista de cima) usado como marcador no mapa, por tipo.
// PNGs em /public/markers — recortados com fundo transparente.
export const VEHICLE_ICONS: Record<VehicleType, string> = {
  CAR: '/markers/car-top.png',
  MOTORCYCLE: '/markers/moto-top.png',
};

export const STATUS_COLORS: Record<DisplayStatus, string> = {
  ignition_on: '#22c55e',  // green-500 — motor ligado
  ignition_off: '#ef4444', // red-500   — motor desligado
  gps_silent: '#f97316',   // orange-500 — GPS silenciado (possível sabotagem)
  offline: '#6b7280',      // gray-500   — sem comunicação
  alert: '#dc2626',        // red-600    — BLOQUEADO
};

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  ignition_on: 'Ligado',
  ignition_off: 'Desligado',
  gps_silent: 'Sem sinal',
  offline: 'Sem comunicação',
  alert: 'Bloqueado',
};

// Orientação ao usuário quando o estado indica problema (não é uso normal).
// O dono não quer saber de jargão técnico ("GPS silenciado") — quer uma AÇÃO
// clara. Mostrada no painel/lista nos estados que pedem intervenção.
export const STATUS_HINTS: Partial<Record<DisplayStatus, string>> = {
  gps_silent: 'Entre em contato com a central',
  offline: 'Entre em contato com a central',
};

// Tempo em ms para considerar um dispositivo offline
export const OFFLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutos

// Acima desse gap entre AGORA e a última posição GPS real, o veículo é
// tratado como 'stopped' mesmo se o último speed > 0 — rastreadores
// GT06/Concox/Suntech costumam parar de mandar GPS quando ficam estáticos
// (só mandam heartbeat), o que mantinha "Em movimento · 2 km/h" travado.
export const STALE_POSITION_MS = 3 * 60 * 1000; // 3 minutos
