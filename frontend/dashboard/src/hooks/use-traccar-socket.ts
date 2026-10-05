'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { TraccarPosition, TraccarDevice } from '@/types/traccar';
import type { Alert } from '@/types/alert';
import type { BleSightingEvent } from '@/types/ble-tag';

interface UseTraccarSocketOptions {
  token: string | null;
  onPositionUpdate?: (position: TraccarPosition) => void;
  /** Lote de 1 s do backend (`positions:batch`) — é assim que o painel recebe posição hoje. */
  onPositionsBatch?: (positions: TraccarPosition[]) => void;
  onDeviceUpdate?: (device: TraccarDevice) => void;
  /** Lote de 1 s do backend (`devices:batch`). */
  onDevicesBatch?: (devices: TraccarDevice[]) => void;
  onAlert?: (alert: Alert) => void;
  onBleSighting?: (event: BleSightingEvent) => void;
}

export function useTraccarSocket({
  token,
  onPositionUpdate,
  onPositionsBatch,
  onDeviceUpdate,
  onDevicesBatch,
  onAlert,
  onBleSighting,
}: UseTraccarSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      disconnect();
      return;
    }

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';
    const socket = io(`${wsUrl}/tracking`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = socket;

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('position:update', (data: TraccarPosition) => {
      onPositionUpdate?.(data);
    });

    socket.on('positions:batch', (data: TraccarPosition[]) => {
      if (Array.isArray(data) && data.length > 0) onPositionsBatch?.(data);
    });

    socket.on('device:update', (data: TraccarDevice) => {
      onDeviceUpdate?.(data);
    });

    socket.on('devices:batch', (data: TraccarDevice[]) => {
      if (Array.isArray(data) && data.length > 0) onDevicesBatch?.(data);
    });

    socket.on('alert:new', (data: Alert) => {
      onAlert?.(data);
    });

    socket.on('ble:sighting', (data: BleSightingEvent) => {
      onBleSighting?.(data);
    });

    return () => {
      socket.disconnect();
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return { isConnected, disconnect };
}
