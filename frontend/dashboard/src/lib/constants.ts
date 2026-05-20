import type { DisplayStatus } from '@/types/vehicle';

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
  url: string;
  /** Quando true, só carrega se HAS_MAPTILER. */
  requiresKey: boolean;
}

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
    // Estilo "hybrid" = imagery aérea + rótulos de ruas e cidades sobrepostos.
    // É o equivalente ao satélite do Google Maps. Sem chave, não fica disponível.
    url: HAS_MAPTILER ? maptilerStyle('hybrid') : '',
    requiresKey: true,
  },
];

// Estilo padrão usado no /mapa ao primeiro load.
export const MAP_STYLE_URL = BASEMAPS[0].url;

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
  gps_silent: 'GPS silenciado',
  offline: 'Offline',
  alert: 'Bloqueado',
};

// Tempo em ms para considerar um dispositivo offline
export const OFFLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutos

// Acima desse gap entre AGORA e a última posição GPS real, o veículo é
// tratado como 'stopped' mesmo se o último speed > 0 — rastreadores
// GT06/Concox/Suntech costumam parar de mandar GPS quando ficam estáticos
// (só mandam heartbeat), o que mantinha "Em movimento · 2 km/h" travado.
export const STALE_POSITION_MS = 3 * 60 * 1000; // 3 minutos
