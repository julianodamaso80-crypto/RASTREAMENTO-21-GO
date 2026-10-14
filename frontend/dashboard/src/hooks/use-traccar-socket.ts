'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { TraccarPosition, TraccarDevice } from '@/types/traccar';
import type { Alert } from '@/types/alert';
import type { BleSightingEvent } from '@/types/ble-tag';
import type { AtributosItem } from '@/lib/tracking-polling';
import { criarCoalescedorDeLotes, type LoteTempoReal } from '@/lib/coalescedor-lotes';

interface UseTraccarSocketOptions {
  token: string | null;
  onPositionUpdate?: (position: TraccarPosition) => void;
  /** Lote de 1 s do backend (`positions:batch`) — é assim que o painel recebe posição hoje. */
  onPositionsBatch?: (positions: TraccarPosition[]) => void;
  onDeviceUpdate?: (device: TraccarDevice) => void;
  /** Lote de 1 s do backend (`devices:batch`). */
  onDevicesBatch?: (devices: TraccarDevice[]) => void;
  /** Lote de 1 s (`attrs:batch`): ignição/energia de pacotes sem fix, sem coordenada. */
  onAttrsBatch?: (itens: AtributosItem[]) => void;
  /** Os três lotes acima que chegaram no mesmo tique, numa chamada só (um render). */
  onLote?: (lote: LoteTempoReal) => void;
  onAlert?: (alert: Alert) => void;
  onBleSighting?: (event: BleSightingEvent) => void;
  /** Reconectou depois de já ter conectado: o que passou no intervalo se perdeu. */
  onReconnect?: () => void;
}

export function useTraccarSocket({
  token,
  onPositionUpdate,
  onPositionsBatch,
  onDeviceUpdate,
  onDevicesBatch,
  onAttrsBatch,
  onLote,
  onAlert,
  onBleSighting,
  onReconnect,
}: UseTraccarSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const jaConectou = useRef(false);
  // Ref: o socket é criado uma vez por token e precisa chamar o onLote atual.
  const onLoteRef = useRef(onLote);
  useEffect(() => {
    onLoteRef.current = onLote;
  }, [onLote]);

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
    const coalescedor = criarCoalescedorDeLotes((lote) => onLoteRef.current?.(lote));

    socket.on('connect', () => {
      setIsConnected(true);
      if (jaConectou.current) onReconnect?.();
      jaConectou.current = true;
    });
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('position:update', (data: TraccarPosition) => {
      onPositionUpdate?.(data);
    });

    socket.on('positions:batch', (data: TraccarPosition[]) => {
      if (Array.isArray(data) && data.length > 0) {
        onPositionsBatch?.(data);
        coalescedor.positions(data);
      }
    });

    socket.on('device:update', (data: TraccarDevice) => {
      onDeviceUpdate?.(data);
    });

    socket.on('devices:batch', (data: TraccarDevice[]) => {
      if (Array.isArray(data) && data.length > 0) {
        onDevicesBatch?.(data);
        coalescedor.devices(data);
      }
    });

    socket.on('attrs:batch', (data: AtributosItem[]) => {
      if (Array.isArray(data) && data.length > 0) {
        onAttrsBatch?.(data);
        coalescedor.atributos(data);
      }
    });

    socket.on('alert:new', (data: Alert) => {
      onAlert?.(data);
    });

    socket.on('ble:sighting', (data: BleSightingEvent) => {
      onBleSighting?.(data);
    });

    return () => {
      coalescedor.cancelar();
      socket.disconnect();
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return { isConnected, disconnect };
}
