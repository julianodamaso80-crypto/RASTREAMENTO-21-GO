import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';
import { useAuth } from './auth-store';
import { Position } from './api';

const KNOTS_TO_KMH = 1.852;

/**
 * Base do WebSocket. O socket.io fica na RAIZ do backend (namespace /tracking),
 * não sob /api/v1 — então derivamos tirando o sufixo da API. Override opcional
 * via EXPO_PUBLIC_WS_URL.
 */
const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
  'https://api.trackgo.site/api/v1';

const WS_URL =
  process.env.EXPO_PUBLIC_WS_URL || API_URL.replace(/\/api\/v1\/?$/, '');

/** Posição bruta que o Traccar emite pelo WebSocket (velocidade em nós). */
export interface RawTraccarPosition {
  deviceId: number;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  address?: string | null;
  fixTime: string;
  attributes?: {
    ignition?: boolean;
    motion?: boolean;
    batteryLevel?: number;
    power?: number;
    sat?: number;
    satellites?: number;
    totalDistance?: number;
    powerCut?: boolean;
  };
}

export interface RawTraccarDevice {
  id: number;
  status: string;
  lastUpdate: string | null;
}

/** Converte a posição bruta do Traccar no mesmo shape que a REST /app entrega. */
export function mapTraccarPosition(p: RawTraccarPosition): Position {
  return {
    latitude: p.latitude,
    longitude: p.longitude,
    speed: Math.round((p.speed ?? 0) * KNOTS_TO_KMH),
    course: p.course ?? 0,
    address: p.address ?? null,
    fixTime: p.fixTime,
    ignition: p.attributes?.ignition ?? null,
    motion: p.attributes?.motion ?? null,
    battery: p.attributes?.batteryLevel ?? null,
    voltage: p.attributes?.power ?? null,
    satellites: p.attributes?.sat ?? p.attributes?.satellites ?? null,
    odometer:
      p.attributes?.totalDistance != null
        ? Math.round(p.attributes.totalDistance / 1000)
        : null,
    powerCut: p.attributes?.powerCut ?? null,
  };
}

interface RealtimeHandlers {
  onPosition: (deviceId: number, position: Position) => void;
  onDevice?: (device: RawTraccarDevice) => void;
}

/**
 * Assina o stream de posição em tempo real do associado (sala `associate:<id>`
 * no gateway). Retorna `connected` pra UI mostrar o selo "ao vivo".
 * Os callbacks vão por ref pra não reabrir o socket a cada render.
 */
export function useVehicleRealtime({ onPosition, onDevice }: RealtimeHandlers): {
  connected: boolean;
} {
  const token = useAuth((s) => s.token);
  const [connected, setConnected] = useState(false);
  const handlers = useRef({ onPosition, onDevice });
  handlers.current = { onPosition, onDevice };

  useEffect(() => {
    if (!token) {
      setConnected(false);
      return;
    }

    const socket: Socket = io(`${WS_URL}/tracking`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('position:update', (raw: RawTraccarPosition) => {
      if (raw?.deviceId == null) return;
      handlers.current.onPosition(raw.deviceId, mapTraccarPosition(raw));
    });

    socket.on('device:update', (raw: RawTraccarDevice) => {
      if (raw?.id == null) return;
      handlers.current.onDevice?.(raw);
    });

    return () => {
      socket.disconnect();
    };
  }, [token]);

  return { connected };
}
