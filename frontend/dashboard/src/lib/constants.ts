import type { DisplayStatus } from '@/types/vehicle';

export const MAP_CENTER: [number, number] = [-49.2643, -16.6869]; // Goiânia
export const MAP_ZOOM = 12;

export const CARTO_DARK_MATTER_URL =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

export const STATUS_COLORS: Record<DisplayStatus, string> = {
  moving: '#10b981',   // emerald-500
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
