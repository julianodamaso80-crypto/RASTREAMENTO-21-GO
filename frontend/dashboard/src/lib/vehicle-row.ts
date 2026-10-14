import type { Vehicle, VehicleWithTracking } from '@/types/vehicle';
import type { TraccarDevice, TraccarPosition } from '@/types/traccar';
import { getDisplayStatus, estaAndando, estaConectado } from '@/lib/utils';

/**
 * Linha do painel: veículo + device + posição. `minuto` não entra na conta —
 * ele só existe para o cache saber que o relógio andou (o status depende de
 * Date.now()).
 */
export function derivarLinha(
  vehicle: Vehicle,
  device: TraccarDevice | undefined,
  position: TraccarPosition | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- chave do cache
  _minuto: number,
): VehicleWithTracking {
  const speed = position?.speed ?? 0;
  // `lastUpdate` = heartbeat do device (Traccar atualiza mesmo em keep-alive
  // sem GPS novo). `positionTime` = quando o GPS efetivamente mexeu.
  // Os dois divergem quando o rastreador para de mandar posições mas continua
  // online — caso típico de carro parado com ignição ligada em GT06/Concox.
  // Sem fallback para `vehicle.updatedAt`: rastreador que nunca falou com o
  // nosso servidor (migração da Rede ainda não pegou) aparecia como
  // "desligada há 4h" — a hora era a do cadastro, não de contato nenhum.
  const lastUpdate = device?.lastUpdate || position?.serverTime || '';
  const positionTime = position?.fixTime || position?.deviceTime || position?.serverTime || null;
  const deviceStatus = device?.status || 'offline';
  const ignition = (position?.attributes?.ignition as boolean) ?? false;
  const vehicleType = vehicle.vehicleType ?? 'CAR';
  const displayStatus = getDisplayStatus({
    lastUpdate,
    positionTime: position ? positionTime : null,
    latitude: position?.latitude ?? 0,
    longitude: position?.longitude ?? 0,
    vehicleStatus: vehicle.status,
    vehicleType,
  });
  // Como na Rede: desconectado não informa velocidade nem movimento.
  const moving = estaConectado(displayStatus) && estaAndando(speed, positionTime);

  return {
    ...vehicle,
    vehicleType,
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
    moving,
    satellites: (position?.attributes?.sat as number) ?? 0,
  };
}

interface Entrada {
  vehicle: Vehicle;
  device: TraccarDevice | undefined;
  position: TraccarPosition | undefined;
  minuto: number;
  linha: VehicleWithTracking;
}

/**
 * Cache por veículo: um lote que mexe em 500 de 7.000 veículos recalcula 500
 * linhas, e as outras voltam com a mesma referência.
 */
export function criarCacheLinhas() {
  const entradas = new Map<string, Entrada>();
  let recalculos = 0;
  return {
    obter(
      vehicle: Vehicle,
      device: TraccarDevice | undefined,
      position: TraccarPosition | undefined,
      minuto: number,
    ): VehicleWithTracking {
      const e = entradas.get(vehicle.id);
      if (
        e &&
        e.vehicle === vehicle &&
        e.device === device &&
        e.position === position &&
        e.minuto === minuto
      ) {
        return e.linha;
      }
      recalculos++;
      const linha = derivarLinha(vehicle, device, position, minuto);
      entradas.set(vehicle.id, { vehicle, device, position, minuto, linha });
      return linha;
    },
    /** Tira do cache quem não está mais na frota. */
    podar(vivos: { has(id: string): boolean }) {
      for (const id of entradas.keys()) if (!vivos.has(id)) entradas.delete(id);
    },
    get recalculos() {
      return recalculos;
    },
    get tamanho() {
      return entradas.size;
    },
  };
}
