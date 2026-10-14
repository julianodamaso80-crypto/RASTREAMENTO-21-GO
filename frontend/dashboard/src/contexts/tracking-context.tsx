'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { Vehicle, VehicleWithTracking } from '@/types/vehicle';
import type { TraccarDevice, TraccarPosition } from '@/types/traccar';
import type { Alert } from '@/types/alert';
import type { BleTag, BleSightingEvent } from '@/types/ble-tag';
import { vehiclesApi, traccarApi, alertsApi, bleTagsApi, clientsApi } from '@/lib/api';
import { PERFIS_QUE_VEEM_TAG, type TagNoMapa } from '@/types/tag-map';
import { tagCasaBusca, tagsDaAba, type FiltroDoMapa } from '@/lib/tags-no-mapa';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { useTraccarSocket } from '@/hooks/use-traccar-socket';
import { estaConectado } from '@/lib/utils';
import { criarCacheLinhas } from '@/lib/vehicle-row';
import type { LoteTempoReal } from '@/lib/coalescedor-lotes';
import { matchesVehicleSearch } from '@/lib/vehicle-search';
import {
  MODO_POLLING,
  POLL_MS,
  aplicarAtributos,
  decidirPolling,
  devePedirFrotaHttp,
  mesclarDevices,
  mesclarPosicoes,
} from '@/lib/tracking-polling';

interface StatusCounts {
  total: number;
  /** Como na Rede, "Online" soma os S/RESP (ainda conectados). */
  online: number;
  sem_resp: number;
  offline: number;
  sleep: number;
  sem_gps: number;
  /** Ignição ligada com o rastreador conectado. */
  ignicao: number;
  movimento: number;
  alert: number;
  /** Veículos que só têm TAG (sem rastreador). Também entram no `total`. */
  tag: number;
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
  statusFilter: FiltroDoMapa;
  setStatusFilter: (f: FiltroDoMapa) => void;
  statusCounts: StatusCounts;
  isSocketConnected: boolean;
  isLoading: boolean;
  alerts: Alert[];
  unreadCount: number;
  markAlertRead: (id: string) => void;
  markAllAlertsRead: () => void;
  bleTags: BleTag[];
  refreshBleTags: () => Promise<void>;
  /**
   * TAGs de cliente sem rastreador — o mesmo conjunto dos cards "só TAG" de
   * Clientes Ativos. Vazio para quem não é time interno: a TAG é segredo.
   */
  tags: TagNoMapa[];
  /** As TAGs que a busca e a aba deixam na tela. */
  filteredTags: TagNoMapa[];
  /** A TAG aberta no mapa. Selecionar TAG solta os veículos, e vice-versa. */
  selectedTagId: string | null;
  selectTag: (id: string | null) => void;
  refreshTags: () => Promise<void>;
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
  const [statusFilter, setStatusFilter] = useState<FiltroDoMapa>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [bleTags, setBleTags] = useState<BleTag[]>([]);
  const [tags, setTags] = useState<TagNoMapa[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const veTags = PERFIS_QUE_VEEM_TAG.includes(user?.role ?? '');

  const refreshTags = useCallback(async () => {
    if (!veTags) {
      setTags([]);
      return;
    }
    try {
      setTags(await clientsApi.getTagsMap());
    } catch {
      // mantém as últimas — TAG é complemento, não pode derrubar o mapa
    }
  }, [veTags]);

  // A posição da TAG vem da coleta na rede Find My (minutos, não segundos):
  // recarregar a cada 60 s basta. Aba escondida não busca, como os veículos.
  useEffect(() => {
    if (!token) return;
    void refreshTags();
    const id = setInterval(() => {
      if (!document.hidden) void refreshTags();
    }, 60_000);
    return () => clearInterval(id);
  }, [token, refreshTags]);

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
    // Páginas de 200 viravam 20 chamadas em fila (~2 s cada, medido no Traefik
    // em 30/09/2026): a lista levava ~45 s para existir e a busca por placa
    // "não achava" enquanto isso. Com 2.000 são 2 chamadas.
    const perPage = 2000;
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
        const pedeFrota = devePedirFrotaHttp(user?.role);
        // `allSettled`, não `all`. Com `all`, UMA chamada lenta segurava as
        // outras quatro e o painel inteiro ficava em branco — foi o que os
        // usuários viram em 22/09/2026. Aqui cada pedaço que chega é usado, e
        // o que falhou só deixa a sua própria parte vazia: a tela SEMPRE abre.
        const [vehiclesR, devicesR, positionsR, alertsR, unreadR] = await Promise.allSettled([
          loadAllVehicles(),
          pedeFrota ? traccarApi.getDevices() : Promise.resolve([] as TraccarDevice[]),
          pedeFrota ? traccarApi.getPositions() : Promise.resolve([] as TraccarPosition[]),
          alertsApi.getAll({ perPage: 50 }),
          alertsApi.getUnreadCount(),
        ]);

        if (alertsR.status === 'fulfilled') setAlerts(alertsR.value.data);
        if (unreadR.status === 'fulfilled') setUnreadCount(unreadR.value);

        const vMap = new Map<string, Vehicle>();
        if (vehiclesR.status === 'fulfilled') {
          vehiclesR.value.forEach((v) => vMap.set(v.id, v));
        }

        const dMap = new Map<number, TraccarDevice>();
        if (devicesR.status === 'fulfilled') {
          devicesR.value.forEach((d) => dMap.set(d.id, d));
        }

        const pMap = new Map<number, TraccarPosition>();
        if (positionsR.status === 'fulfilled') {
          positionsR.value.forEach((p) => pMap.set(p.deviceId, p));
        }

        setVehicleMap(vMap);
        setDeviceMap(dMap);
        setPositionMap(pMap);

        // Estado vazio nunca vira mock, mas o operador precisa saber o que
        // faltou em vez de achar que a frota sumiu. O polling de 8s recupera.
        const faltou = [
          vehiclesR.status === 'rejected' && 'veículos',
          devicesR.status === 'rejected' && 'rastreadores',
          positionsR.status === 'rejected' && 'posições',
        ].filter(Boolean);
        if (faltou.length > 0) {
          toast.error(`Não carregou: ${faltou.join(', ')}. Tentando de novo em segundos.`);
        }

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
  }, [loadAllVehicles, user?.role]);

  // Polling de GARANTIA. O WebSocket dá updates instantâneos, mas se ele cair,
  // não reconectar, ou o backend não emitir `position:update` (ex.: device fora
  // do deviceTenantMap), o mapa "congelava" na última posição carregada. Aqui
  // re-buscamos posições + devices a cada 8s direto do Traccar (REST), então o
  // marcador e o endereço SEMPRE refletem o dado real e atual — sem depender só
  // do WS. Rastreamento não pode parar de atualizar.
  //
  // Com NEXT_PUBLIC_POLLING_MODE=contingencia a frota só vem pelo REST quando o
  // socket está fora ou mudo, e numa reconciliação a cada 60 s; sem a env, é o
  // polling de 8 s de sempre. Quem decide é `decidirPolling`.
  // Refs: o timer lê o valor atual sem recriar o intervalo a cada reconexão.
  const socketConectadoRef = useRef(false);
  const ultimoLoteEmRef = useRef<number | null>(null);
  const ultimaFrotaEmRef = useRef(0);
  const ultimosVehiclesEmRef = useRef(0);
  const forcarCompletoRef = useRef(false);
  const pollRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let tick = 0;
    let emAndamento = false;
    // O carregamento inicial acabou de buscar tudo: os prazos contam daqui.
    ultimaFrotaEmRef.current = Date.now();
    ultimosVehiclesEmRef.current = Date.now();
    // Token novo = socket novo: o último lote do socket anterior não vale.
    ultimoLoteEmRef.current = null;
    const poll = async () => {
      // Aba escondida não mostra mapa: baixar a frota a cada 8s em toda aba
      // aberta somou 8 GB num dia só do escritório (18/09/2026) e saturou o
      // link — o estoque levava minutos para responder. Volta na hora ao aparecer.
      if (document.hidden) return;
      // Um ciclo de cada vez: quando o backend demora mais que 8 s, o intervalo
      // empilhava pedidos (medido em 30/09/2026: 10.541 chamadas a /vehicles em
      // 2 h) e cada um chegava mais lento que o anterior.
      if (emAndamento) return;
      const agora = Date.now();
      // A lista de veículos também precisa acompanhar: um vínculo feito no
      // estoque (outra aba ou outra rota) criava veículo que só aparecia no
      // mapa depois de F5. A cada 4 ciclos (~32s) recarrega a lista.
      tick++;
      const decisao = decidirPolling({
        modo: MODO_POLLING,
        agora,
        tique: tick,
        socketConectado: socketConectadoRef.current,
        ultimoLoteEm: ultimoLoteEmRef.current,
        ultimaFrotaEm: ultimaFrotaEmRef.current,
        ultimosVehiclesEm: ultimosVehiclesEmRef.current,
      });
      const forcar = forcarCompletoRef.current;
      const buscarFrota = devePedirFrotaHttp(user?.role) && (decisao.frota || forcar);
      const buscarVehicles = decisao.vehicles || forcar;
      if (!buscarFrota && !buscarVehicles) return;
      forcarCompletoRef.current = false;
      // Conta a partir da tentativa, com ou sem sucesso, como o contador de
      // tiques de antes: backend fora não pode virar /vehicles a cada 8 s.
      if (buscarFrota) ultimaFrotaEmRef.current = agora;
      if (buscarVehicles) ultimosVehiclesEmRef.current = agora;
      emAndamento = true;
      try {
        const [devices, positions, vehiclesList] = await Promise.all([
          buscarFrota ? traccarApi.getDevices() : Promise.resolve(null),
          buscarFrota ? traccarApi.getPositions() : Promise.resolve(null),
          buscarVehicles ? loadAllVehicles() : Promise.resolve(null),
        ]);
        if (cancelled) return;
        // Mesclar, e não trocar o mapa: o lote do WebSocket pode ser mais novo
        // que o snapshot desta resposta.
        if (devices && positions) {
          setDeviceMap((prev) => mesclarDevices(prev, devices));
          setPositionMap((prev) => mesclarPosicoes(prev, positions));
        }
        if (vehiclesList) {
          setVehicleMap(new Map(vehiclesList.map((v) => [v.id, v])));
        }
      } catch {
        // silencia — mantém os últimos dados até a próxima tentativa
      } finally {
        emAndamento = false;
      }
    };
    pollRef.current = poll;
    const id = setInterval(poll, POLL_MS);
    const aoVoltar = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      cancelled = true;
      pollRef.current = null;
      clearInterval(id);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [token, loadAllVehicles, user?.role]);

  // O que chegou enquanto o socket estava fora se perdeu: recarrega tudo. No
  // legado o tique de 8 s já cobre isso, e o comportamento fica o de hoje.
  // Se a aba estiver escondida ou houver ciclo em andamento, o próximo tique
  // faz a carga completa.
  const handleReconnect = useCallback(() => {
    if (MODO_POLLING !== 'contingencia') return;
    forcarCompletoRef.current = true;
    void pollRef.current?.();
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

  // `positions:batch`, `devices:batch` e `attrs:batch` do mesmo segundo chegam
  // aqui juntos: um render só. `devices:batch` sai a cada mensagem do
  // rastreador, mesmo sem GPS — é o melhor sinal de que o elo backend↔Traccar
  // está vivo (watchdog do socket mudo). Atributos (ignição/energia de pacote
  // sem fix) vêm depois das posições e nunca mexem na coordenada.
  const handleLote = useCallback(({ positions, devices, atributos }: LoteTempoReal) => {
    ultimoLoteEmRef.current = Date.now();
    if (process.env.NODE_ENV !== 'production') {
      const stats = statsDev();
      stats.lotes++;
      stats.ultimoLoteTamanho = positions.length + devices.length + atributos.length;
    }
    if (positions.length > 0 || atributos.length > 0) {
      setPositionMap((prev) => {
        let next = prev;
        if (positions.length > 0) {
          next = new Map(prev);
          for (const position of positions) next.set(position.deviceId, position);
        }
        return atributos.length > 0 ? aplicarAtributos(next, atributos) : next;
      });
    }
    if (devices.length > 0) {
      setDeviceMap((prev) => {
        const next = new Map(prev);
        for (const device of devices) next.set(device.id, device);
        return next;
      });
    }
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
    onLote: handleLote,
    onAlert: handleAlert,
    onBleSighting: handleBleSighting,
    onReconnect: handleReconnect,
  });

  useEffect(() => {
    socketConectadoRef.current = isConnected;
  }, [isConnected]);

  // O status depende do relógio (30 min, 60 min, 2 dias sem contato): sem
  // este tique, rastreador que parou de falar ficaria ONLINE até chegar outro
  // evento qualquer. Cada linha sabe o instante exato da próxima virada; o
  // tique de 1 s só pede render quando alguma já venceu.
  const cacheLinhas = useRef(criarCacheLinhas());
  const [relogio, setRelogio] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (cacheLinhas.current.venceuAlguma(Date.now())) setRelogio((n) => n + 1);
    }, 1_000);
    return () => clearInterval(id);
  }, []);

  // Merge vehicles + devices + positions. Só recalcula a linha de quem mudou
  // ou cujo status virou pelo relógio.
  const vehicles = useMemo<VehicleWithTracking[]>(() => {
    const cache = cacheLinhas.current;
    const antes = cache.recalculos;
    const agora = Date.now();
    const result: VehicleWithTracking[] = [];
    vehicleMap.forEach((vehicle) => {
      const deviceId = vehicle.traccarDeviceId;
      const device = deviceId ? deviceMap.get(deviceId) : undefined;
      const position = deviceId ? positionMap.get(deviceId) : undefined;
      result.push(cache.obter(vehicle, device, position, agora));
    });
    cache.podar(vehicleMap);
    if (process.env.NODE_ENV !== 'production') statsDev().recalculos += cache.recalculos - antes;
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relogio só força o recálculo das vencidas
  }, [vehicleMap, deviceMap, positionMap, relogio]);

  // Filtros
  //
  // A busca vem antes das abas: elas contam DENTRO do que a busca achou, senão
  // "Todos" continuaria dizendo 491 com o termo escrito em cima e o operador
  // leria isso como "não filtrou nada".
  const searchedVehicles = useMemo(() => {
    if (!searchQuery) return vehicles;
    return vehicles.filter((v) => matchesVehicleSearch(v, searchQuery));
  }, [vehicles, searchQuery]);

  const filteredVehicles = useMemo(() => {
    if (statusFilter === 'all') return searchedVehicles;
    if (statusFilter === 'tag') return [];
    return searchedVehicles.filter((v) => casaFiltro(v, statusFilter));
  }, [searchedVehicles, statusFilter]);

  const searchedTags = useMemo(
    () => (searchQuery ? tags.filter((t) => tagCasaBusca(t, searchQuery)) : tags),
    [tags, searchQuery],
  );
  const filteredTags = useMemo(
    () => tagsDaAba(searchedTags, statusFilter, !!searchQuery),
    [searchedTags, statusFilter, searchQuery],
  );

  // Contadores
  const statusCounts = useMemo<StatusCounts>(() => {
    const counts: StatusCounts = {
      total: 0,
      online: 0,
      sem_resp: 0,
      offline: 0,
      sleep: 0,
      sem_gps: 0,
      ignicao: 0,
      movimento: 0,
      alert: 0,
      tag: 0,
    };
    searchedVehicles.forEach((v) => {
      counts.total++;
      for (const f of ABAS_CONTADAS) if (casaFiltro(v, f)) counts[f]++;
    });
    // "Todos" = veículos com rastreador + veículos só com TAG — o mesmo total
    // de Clientes Ativos.
    counts.tag = searchedTags.length;
    counts.total += tagsDaAba(searchedTags, 'all', !!searchQuery).length;
    return counts;
  }, [searchedVehicles, searchedTags, searchQuery]);

  // Só existe "o veículo selecionado" quando há exatamente um marcado. Com
  // vários, quem manda na tela é o painel de lista — e a câmera não persegue
  // ninguém, senão fica pulando entre carros indo pra lados diferentes.
  const selectedVehicleId = selectedIds.length === 1 ? selectedIds[0] : null;

  const selectVehicle = useCallback((id: string | null) => {
    setSelectedIds(id ? [id] : []);
    setSelectedTagId(null);
  }, []);

  const selectTag = useCallback((id: string | null) => {
    setSelectedTagId(id);
    setSelectedIds([]);
  }, []);

  // Marcar acrescenta no FIM da lista: a numeração do pino no mapa é a ordem
  // em que o operador marcou, e ela não pode dançar quando ele marca o quarto.
  const toggleVehicle = useCallback((id: string) => {
    setSelectedTagId(null);
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

  // Sem memo, qualquer estado do Provider recriava o objeto
  // e re-renderizava todos os consumidores.
  const value = useMemo<TrackingContextType>(
    () => ({
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
      tags,
      filteredTags,
      selectedTagId,
      selectTag,
      refreshTags,
      updateVehicleLocal,
    }),
    [
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
      isConnected,
      isLoading,
      alerts,
      unreadCount,
      markAlertRead,
      markAllAlertsRead,
      bleTags,
      refreshBleTags,
      tags,
      filteredTags,
      selectedTagId,
      selectTag,
      refreshTags,
      updateVehicleLocal,
    ],
  );

  return (
    <TrackingContext.Provider value={value}>
      {children}
    </TrackingContext.Provider>
  );
}

interface TrackingStats {
  recalculos: number;
  lotes: number;
  ultimoLoteTamanho: number;
}

/** Contadores para medir no navegador (`window.__trackingStats`); só fora de produção. */
function statsDev(): TrackingStats {
  // No SSR não há window: conta num objeto descartável.
  if (typeof window === 'undefined') return { recalculos: 0, lotes: 0, ultimoLoteTamanho: 0 };
  const w = window as unknown as { __trackingStats?: TrackingStats };
  w.__trackingStats ??= { recalculos: 0, lotes: 0, ultimoLoteTamanho: 0 };
  return w.__trackingStats;
}

export function useTracking() {
  const ctx = useContext(TrackingContext);
  if (!ctx) throw new Error('useTracking must be used within TrackingProvider');
  return ctx;
}

const ABAS_CONTADAS = [
  'online',
  'sem_resp',
  'offline',
  'sleep',
  'sem_gps',
  'ignicao',
  'movimento',
  'alert',
] as const;

/** O veículo entra na aba? Mesma composição do filtro de status da Rede. */
function casaFiltro(v: VehicleWithTracking, filtro: FiltroDoMapa): boolean {
  switch (filtro) {
    case 'all':
      return true;
    case 'tag':
      return false;
    case 'online':
      return v.displayStatus === 'online' || v.displayStatus === 'sem_resp';
    case 'ignicao':
      return estaConectado(v.displayStatus) && v.ignition;
    case 'movimento':
      return v.moving;
    default:
      return v.displayStatus === filtro;
  }
}
