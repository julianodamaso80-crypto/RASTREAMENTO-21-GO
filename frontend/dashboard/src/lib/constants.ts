import type { DisplayStatus } from '@/types/vehicle';

export const MAP_CENTER: [number, number] = [-49.2643, -16.6869]; // Goiânia
export const MAP_ZOOM = 12;

export const CARTO_DARK_MATTER_URL =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Estilo claro tipo Google Maps — colorido, ruas claras, prédios cinza,
// parques verdes, água azul. Free, sem API key. Ideal pra cliente final.
export const CARTO_VOYAGER_URL =
  'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

// Estilo padrão usado no /mapa. Trocar pra DARK_MATTER se quiser tema escuro.
export const MAP_STYLE_URL = CARTO_VOYAGER_URL;

export const STATUS_COLORS: Record<DisplayStatus, string> = {
  moving: '#bfd741',   // brand-green
  stopped: '#eab308',  // yellow-500
  alert: '#ef4444',    // red-500
  offline: '#6b7280',  // gray-500
};

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  moving: 'Em movimento',
  stopped: 'Parado',
  alert: 'Alerta',
  offline: 'Offline',
};

// Tempo em ms para considerar um dispositivo offline
export const OFFLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutos
