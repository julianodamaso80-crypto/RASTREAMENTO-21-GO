'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { Vehicle, VehicleWithTracking, DisplayStatus } from '@/types/vehicle';
import type { TraccarDevice, TraccarPosition } from '@/types/traccar';
import type { Alert } from '@/types/alert';
import type { BleTag, BleSightingEvent } from '@/types/ble-tag';
import { vehiclesApi, traccarApi, alertsApi, bleTagsApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { useTraccarSocket } from '@/hooks/use-traccar-socket';
import { getDisplayStatus } from '@/lib/utils';

interface StatusCounts {
  total: number;
  ignition_on: number;
  ignition_off: number;
  offline: number;
  alert: number;
}

interface TrackingContextType {
  vehicles: VehicleWithTracking[];
  filteredVehicles: VehicleWithTracking[];
  selectedVehicleId: string | null;
  selectVehicle: (id: string | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  statusFilter: 'all' | DisplayStatus;
  setStatusFilter: (f: 'all' | DisplayStatus) => void;
  statusCounts: StatusCounts;
  isSocketConnected: boolean;
  isLoading: boolean;
  alerts: Alert[];
  unreadCount: number;
  markAlertRead: (id: string) => void;
  markAllAlertsRead: () => void;
  bleTags: BleTag[];
  refreshBleTags: () => Promise<void>;
  // Atualiza um veículo localmente (otimista) — ex.: trocar o tipo (carro/moto)
  // reflete na hora no mapa sem esperar reload.
  updateVehicleLocal: (id: string, patch: Partial<Vehicle>) => void;
}

const TrackingContext = createContext<TrackingContextType | null>(null);

export function TrackingProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [vehicleMap, setVehicleMap] = useState<Map<string, Vehicle>>(new Map());
  const [deviceMap, setDeviceMap] = useState<Map<number, TraccarDevice>>(new Map());
  const [positionMap, setPositionMap] = useState<Map<number, TraccarPosition>>(new Map());
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'all' | DisplayStatus>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [bleTags, setBleTags] = useState<BleTag[]>([]);

  const updateVehicleLocal = useCallback((id: string, patch: Partial<Vehicle>) => {
    setVehicleMap((prev) => {
      const v = prev.get(id);
      if (!v) return prev;
      const next = new Map(prev);
      next.set(id, { ...v, ...patch });
      return next;
    });
  }, []);

  const refreshBleTags = useCallback(async () => {
    try {
      const tags = await bleTagsApi.getAll();
      setBleTags(tags);
    } catch {
      // tenant sem TAGs ou backend offline — silencia
    }
  }, []);

  // Carregar dados iniciais
  useEffect(() => {
    async function loadData() {
      try {
        // CLIENT vê apenas seus veículos via /vehicles/mine; demais roles
        // veem todos do tenant. /mine é safe pro server forçar isolamento.
        const isClient = user?.role === 'CLIENT';
        const vehiclesPromise = isClient
          ? vehiclesApi.getMine({ perPage: 200 })
          : vehiclesApi.getAll({ perPage: 200 });

        const [vehiclesRes, devices, positions, alertsRes, unread] = await Promise.all([
          vehiclesPromise,
          traccarApi.getDevices(),
          traccarApi.getPositions(),
          alertsApi.getAll({ perPage: 50 }),
          alertsApi.getUnreadCount(),
        ]);

        setAlerts(alertsRes.data);
        setUnreadCount(unread);

        const vMap = new Map<string, Vehicle>();
        vehiclesRes.data.forEach((v) => vMap.set(v.id, v));

        const dMap = new Map<number, TraccarDevice>();
        devices.forEach((d) => dMap.set(d.id, d));

        const pMap = new Map<number, TraccarPosition>();
        positions.forEach((p) => pMap.set(p.deviceId, p));

        setVehicleMap(vMap);
        setDeviceMap(dMap);
        setPositionMap(pMap);
        // BLE Tags em paralelo (não-crítico se falhar)
        bleTagsApi
          .getAll()
          .then((tags) => setBleTags(tags))
          .catch(() => undefined);
      } catch (err) {
        // Em produção NUNCA cair pra mock — mostrar estado vazio + toast.
        // Veículos/devices/positions ficam vazios e o operador percebe que
        // o backend está indisponível em vez de ver placas falsas.
        const msg = err instanceof Error ? err.message : 'Falha ao carregar dados';
        toast.error(`Backend indisponível: ${msg}`);
        setVehicleMap(new Map());
        setDeviceMap(new Map());
        setPositionMap(new Map());
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  // Polling de GARANTIA. O WebSocket dá updates instantâneos, mas se ele cair,
  // não reconectar, ou o backend não emitir `position:update` (ex.: device fora
  // do deviceTenantMap), o mapa "congelava" na última posição carregada. Aqui
  // re-buscamos posições + devices a cada 8s direto do Traccar (REST), então o
  // marcador e o endereço SEMPRE refletem o dado real e atual — sem depender só
  // do WS. Rastreamento não pode parar de atualizar.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [devices, positions] = await Promise.all([
          traccarApi.getDevices(),
          traccarApi.getPositions(),
        ]);
        if (cancelled) return;
        setDeviceMap(new Map(devices.map((d) => [d.id, d])));
        setPositionMap(new Map(positions.map((p) => [p.deviceId, p])));
      } catch {
        // silencia — mantém os últimos dados até a próxima tentativa
      }
    };
    const id = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token]);

  // WebSocket
  const handlePositionUpdate = useCallback((position: TraccarPosition) => {
    setPositionMap((prev) => {
      const next = new Map(prev);
      next.set(position.deviceId, position);
      return next;
    });
  }, []);

  const handleDeviceUpdate = useCallback((device: TraccarDevice) => {
    setDeviceMap((prev) => {
      const next = new Map(prev);
      next.set(device.id, device);
      return next;
    });
  }, []);

  const handleAlert = useCallback((alert: Alert) => {
    setAlerts((prev) => [alert, ...prev].slice(0, 100));
    setUnreadCount((prev) => prev + 1);
    toast.warning(`${alert.vehicle?.plate || 'Veículo'}: ${alert.message}`, {
      duration: 5000,
    });
  }, []);

  const handleBleSighting = useCallback((event: BleSightingEvent) => {
    setBleTags((prev) =>
      prev.map((tag) => {
        if (tag.id !== event.deviceId) return tag;
        return {
          ...tag,
          lastConnection: event.sighting.createdAt,
          bleSightings: [event.sighting, ...tag.bleSightings].slice(0, 1),
        };
      }),
    );
  }, []);

  const { isConnected } = useTraccarSocket({
    token,
    onPositionUpdate: handlePositionUpdate,
    onDeviceUpdate: handleDeviceUpdate,
    onAlert: handleAlert,
    onBleSighting: handleBleSighting,
  });

  // Merge vehicles + devices + positions
  const vehicles = useMemo<VehicleWithTracking[]>(() => {
    const result: VehicleWithTracking[] = [];
    vehicleMap.forEach((vehicle) => {
      const deviceId = vehicle.traccarDeviceId;
      const device = deviceId ? deviceMap.get(deviceId) : undefined;
      const position = deviceId ? positionMap.get(deviceId) : undefined;

      const speed = position?.speed ?? 0;
      // `lastUpdate` = heartbeat do device (Traccar atualiza mesmo em keep-alive
      // sem GPS novo). `positionTime` = quando o GPS efetivamente mexeu.
      // Os dois divergem quando o rastreador para de mandar posições mas continua
      // online — caso típico de carro parado com ignição ligada em GT06/Concox.
      const lastUpdate = device?.lastUpdate || position?.serverTime || vehicle.updatedAt;
      const positionTime = position?.fixTime || position?.deviceTime || position?.serverTime || null;
      const deviceStatus = device?.status || 'offline';
      const ignition = (position?.attributes?.ignition as boolean) ?? false;
      const displayStatus = getDisplayStatus(
        deviceStatus,
        speed,
        lastUpdate,
        vehicle.status,
        positionTime,
        ignition,
      );

      result.push({
        ...vehicle,
        vehicleType: vehicle.vehicleType ?? 'CAR',
        latitude: position?.latitude ?? 0,
        longitude: position?.longitude ?? 0,
        speed,
        course: position?.course ?? 0,
        address: position?.address ?? '',
        lastUpdate,
        positionTime,
        deviceStatus,
        displayStatus,
        ignition,
        satellites: (position?.attributes?.sat as number) ?? 0,
      });
    });
    return result;
  }, [vehicleMap, deviceMap, positionMap]);

  // Filtros
  const filteredVehicles = useMemo(() => {
    let list = vehicles;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (v) =>
          v.plate.toLowerCase().includes(q) ||
          (v.model?.toLowerCase().includes(q)) ||
          (v.brand?.toLowerCase().includes(q)),
      );
    }

    if (statusFilter !== 'all') {
      list = list.filter((v) => v.displayStatus === statusFilter);
    }

    return list;
  }, [vehicles, searchQuery, statusFilter]);

  // Contadores
  const statusCounts = useMemo<StatusCounts>(() => {
    const counts: StatusCounts = {
      total: 0,
      ignition_on: 0,
      ignition_off: 0,
      offline: 0,
      alert: 0,
    };
    vehicles.forEach((v) => {
      counts.total++;
      counts[v.displayStatus]++;
    });
    return counts;
  }, [vehicles]);

  const selectVehicle = useCallback((id: string | null) => {
    setSelectedVehicleId(id);
  }, []);

  const markAlertRead = useCallback(async (id: string) => {
    await alertsApi.markAsRead(id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  const markAllAlertsRead = useCallback(async () => {
    await alertsApi.markAllAsRead();
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
    setUnreadCount(0);
  }, []);

  return (
    <TrackingContext.Provider
      value={{
        vehicles,
        filteredVehicles,
        selectedVehicleId,
        selectVehicle,
        searchQuery,
        setSearchQuery,
        statusFilter,
        setStatusFilter,
        statusCounts,
        isSocketConnected: isConnected,
        isLoading,
        alerts,
        unreadCount,
        markAlertRead,
        markAllAlertsRead,
        bleTags,
        refreshBleTags,
        updateVehicleLocal,
      }}
    >
      {children}
    </TrackingContext.Provider>
  );
}

export function useTracking() {
  const ctx = useContext(TrackingContext);
  if (!ctx) throw new Error('useTracking must be used within TrackingProvider');
  return ctx;
}
