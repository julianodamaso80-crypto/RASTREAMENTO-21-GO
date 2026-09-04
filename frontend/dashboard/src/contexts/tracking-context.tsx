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
import { matchesVehicleSearch } from '@/lib/vehicle-search';

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
  /**
   * Veículos marcados, na ordem em que foram marcados — é essa ordem que
   * numera o pino no mapa e a linha do painel.
   */
  selectedIds: string[];
  /**
   * O único marcado, ou `null` quando são vários (ou nenhum).
   *
   * Derivado de `selectedIds`. Quem só sabe lidar com um veículo — o painel de
   * detalhe, o seguimento da câmera — lê daqui e continua funcionando sem
   * mudança: com 2+ marcados a resposta é `null` e essas peças saem de cena
   * pro painel de lista entrar.
   */
  selectedVehicleId: string | null;
  /** Troca a seleção inteira por este veículo (ou limpa tudo com `null`). */
  selectVehicle: (id: string | null) => void;
  /** Marca/desmarca sem mexer nos outros — é o clique na caixinha da lista. */
  toggleVehicle: (id: string) => void;
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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

  // Todos os veículos do tenant, página a página. Um único GET com perPage
  // fixo (200) escondia em silêncio quem passasse desse número — a frota já
  // beira isso e o mapa não pode "perder" veículo.
  // CLIENT vê apenas seus veículos via /vehicles/mine; demais roles veem todos
  // do tenant. /mine é safe pro server forçar isolamento.
  const loadAllVehicles = useCallback(async (): Promise<Vehicle[]> => {
    const isClient = user?.role === 'CLIENT';
    const perPage = 200;
    const all: Vehicle[] = [];
    for (let page = 1; page <= 50; page++) {
      const res = isClient
        ? await vehiclesApi.getMine({ perPage, page })
        : await vehiclesApi.getAll({ perPage, page });
      all.push(...res.data);
      if (res.data.length < perPage || all.length >= res.meta.total) break;
    }
    return all;
  }, [user?.role]);

  // Carregar dados iniciais
  useEffect(() => {
    async function loadData() {
      try {
        const [vehiclesList, devices, positions, alertsRes, unread] = await Promise.all([
          loadAllVehicles(),
          traccarApi.getDevices(),
          traccarApi.getPositions(),
          alertsApi.getAll({ perPage: 50 }),
          alertsApi.getUnreadCount(),
        ]);

        setAlerts(alertsRes.data);
        setUnreadCount(unread);

        const vMap = new Map<string, Vehicle>();
        vehiclesList.forEach((v) => vMap.set(v.id, v));

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
  }, [loadAllVehicles]);

  // Polling de GARANTIA. O WebSocket dá updates instantâneos, mas se ele cair,
  // não reconectar, ou o backend não emitir `position:update` (ex.: device fora
  // do deviceTenantMap), o mapa "congelava" na última posição carregada. Aqui
  // re-buscamos posições + devices a cada 8s direto do Traccar (REST), então o
  // marcador e o endereço SEMPRE refletem o dado real e atual — sem depender só
  // do WS. Rastreamento não pode parar de atualizar.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let tick = 0;
    const poll = async () => {
      try {
        // A lista de veículos também precisa acompanhar: um vínculo feito no
        // estoque (outra aba ou outra rota) criava veículo que só aparecia no
        // mapa depois de F5. A cada 4 ciclos (~32s) recarrega a lista.
        tick++;
        const refreshVehicles = tick % 4 === 0;
        const [devices, positions, vehiclesList] = await Promise.all([
          traccarApi.getDevices(),
          traccarApi.getPositions(),
          refreshVehicles ? loadAllVehicles() : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setDeviceMap(new Map(devices.map((d) => [d.id, d])));
        setPositionMap(new Map(positions.map((p) => [p.deviceId, p])));
        if (vehiclesList) {
          setVehicleMap(new Map(vehiclesList.map((v) => [v.id, v])));
        }
      } catch {
        // silencia — mantém os últimos dados até a próxima tentativa
      }
    };
    const id = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, loadAllVehicles]);

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
  }, []);

  const handleBleSighting = useCallback((event: BleSightingEvent) => {
    setBleTags((prev) =>
      prev.map((tag) => {
        if (tag.id !== event.deviceId) return tag;

        // Backfill entrega até 7 dias de histórico fora de ordem: só troca o
        // sighting exibido e o lastConnection quando o novo seenAt é mais
        // recente que o que já está na tela — senão a posição "pula" pro
        // passado (ver C2/I2).
        const seenAtAtual = tag.bleSightings[0]?.seenAt;
        const maisRecente = !seenAtAtual || event.sighting.seenAt > seenAtAtual;
        if (!maisRecente) return tag;

        return {
          ...tag,
          lastConnection: event.sighting.seenAt,
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
      list = list.filter((v) => matchesVehicleSearch(v, searchQuery));
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

  // Só existe "o veículo selecionado" quando há exatamente um marcado. Com
  // vários, quem manda na tela é o painel de lista — e a câmera não persegue
  // ninguém, senão fica pulando entre carros indo pra lados diferentes.
  const selectedVehicleId = selectedIds.length === 1 ? selectedIds[0] : null;

  const selectVehicle = useCallback((id: string | null) => {
    setSelectedIds(id ? [id] : []);
  }, []);

  // Marcar acrescenta no FIM da lista: a numeração do pino no mapa é a ordem
  // em que o operador marcou, e ela não pode dançar quando ele marca o quarto.
  const toggleVehicle = useCallback((id: string) => {
    setSelectedIds((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );
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
        selectedIds,
        selectedVehicleId,
        selectVehicle,
        toggleVehicle,
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
