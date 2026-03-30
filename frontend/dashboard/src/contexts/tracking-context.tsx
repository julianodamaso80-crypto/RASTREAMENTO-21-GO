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
import { vehiclesApi, traccarApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { useTraccarSocket } from '@/hooks/use-traccar-socket';
import { getDisplayStatus } from '@/lib/utils';
import { mockVehicles, mockDevices, mockPositions } from '@/lib/mock-data';

interface StatusCounts {
  total: number;
  moving: number;
  stopped: number;
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
}

const TrackingContext = createContext<TrackingContextType | null>(null);

export function TrackingProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [vehicleMap, setVehicleMap] = useState<Map<string, Vehicle>>(new Map());
  const [deviceMap, setDeviceMap] = useState<Map<number, TraccarDevice>>(new Map());
  const [positionMap, setPositionMap] = useState<Map<number, TraccarPosition>>(new Map());
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DisplayStatus>('all');
  const [isLoading, setIsLoading] = useState(true);

  // Carregar dados iniciais
  useEffect(() => {
    async function loadData() {
      try {
        const [vehiclesRes, devices, positions] = await Promise.all([
          vehiclesApi.getAll({ perPage: 200 }),
          traccarApi.getDevices(),
          traccarApi.getPositions(),
        ]);

        const vMap = new Map<string, Vehicle>();
        vehiclesRes.data.forEach((v) => vMap.set(v.id, v));

        const dMap = new Map<number, TraccarDevice>();
        devices.forEach((d) => dMap.set(d.id, d));

        const pMap = new Map<number, TraccarPosition>();
        positions.forEach((p) => pMap.set(p.deviceId, p));

        setVehicleMap(vMap);
        setDeviceMap(dMap);
        setPositionMap(pMap);
      } catch {
        // Fallback para mock data
        const vMap = new Map<string, Vehicle>();
        mockVehicles.forEach((v) => vMap.set(v.id, v));

        const dMap = new Map<number, TraccarDevice>();
        mockDevices.forEach((d) => dMap.set(d.id, d));

        const pMap = new Map<number, TraccarPosition>();
        mockPositions.forEach((p) => pMap.set(p.deviceId, p));

        setVehicleMap(vMap);
        setDeviceMap(dMap);
        setPositionMap(pMap);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

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

  const { isConnected } = useTraccarSocket({
    token,
    onPositionUpdate: handlePositionUpdate,
    onDeviceUpdate: handleDeviceUpdate,
  });

  // Merge vehicles + devices + positions
  const vehicles = useMemo<VehicleWithTracking[]>(() => {
    const result: VehicleWithTracking[] = [];
    vehicleMap.forEach((vehicle) => {
      const deviceId = vehicle.traccarDeviceId;
      const device = deviceId ? deviceMap.get(deviceId) : undefined;
      const position = deviceId ? positionMap.get(deviceId) : undefined;

      const speed = position?.speed ?? 0;
      const lastUpdate = device?.lastUpdate || position?.serverTime || vehicle.updatedAt;
      const deviceStatus = device?.status || 'offline';
      const displayStatus = getDisplayStatus(deviceStatus, speed, lastUpdate, vehicle.status);

      result.push({
        ...vehicle,
        latitude: position?.latitude ?? 0,
        longitude: position?.longitude ?? 0,
        speed,
        course: position?.course ?? 0,
        address: position?.address ?? '',
        lastUpdate,
        deviceStatus,
        displayStatus,
        ignition: (position?.attributes?.ignition as boolean) ?? false,
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
    const counts = { total: 0, moving: 0, stopped: 0, offline: 0, alert: 0 };
    vehicles.forEach((v) => {
      counts.total++;
      counts[v.displayStatus]++;
    });
    return counts;
  }, [vehicles]);

  const selectVehicle = useCallback((id: string | null) => {
    setSelectedVehicleId(id);
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
