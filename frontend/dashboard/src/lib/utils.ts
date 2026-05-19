import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { DisplayStatus } from '@/types/vehicle';
import { OFFLINE_THRESHOLD_MS, STALE_POSITION_MS } from './constants';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function maskCPF(cpf: string): string {
  if (!cpf || cpf.length < 11) return cpf || '';
  return `***.***.*${cpf.slice(-4, -2)}-${cpf.slice(-2)}`;
}

export function formatSpeed(knots: number): string {
  const kmh = knots * 1.852;
  return `${Math.round(kmh)} km/h`;
}

export function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'agora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

const SP_TZ = 'America/Sao_Paulo';

/**
 * Formata uma data ISO (UTC do servidor) em horário BR. Independe do fuso
 * do browser do usuário — sempre mostra horário de São Paulo. Usar pra
 * datas absolutas (relatórios, logs, expirações).
 */
export function formatDateBR(isoDate: string): string {
  return new Date(isoDate).toLocaleString('pt-BR', {
    timeZone: SP_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateOnlyBR(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('pt-BR', {
    timeZone: SP_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatTimeOnlyBR(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString('pt-BR', {
    timeZone: SP_TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Calcula o status visível do veículo baseado em:
 *  - status do device no Traccar (heartbeat: online/offline)
 *  - velocidade da última posição GPS (em nós)
 *  - `lastUpdate`  = device.lastUpdate (pode ser só heartbeat, sem GPS novo)
 *  - `positionTime` = quando o GPS mexeu pela última vez (null se nunca veio)
 *
 * Regra crítica: rastreadores GT06/Concox/Suntech costumam parar de enviar
 * GPS quando ficam estáticos por economia — só mandam heartbeat. Resultado:
 * `device.status='online'` + `position.speed=2km/h` (último valor antes de
 * parar) ficavam congelados como "Em movimento". A regra `STALE_POSITION_MS`
 * trata isso: se o GPS não atualiza há mais de 3min, o veículo é 'stopped'
 * mesmo que o último speed conhecido seja > 0.
 */
export function getDisplayStatus(
  deviceStatus: string,
  speed: number,
  lastUpdate: string,
  vehicleStatus: string,
  positionTime: string | null = null,
): DisplayStatus {
  if (vehicleStatus === 'BLOCKED') return 'alert';
  const age = Date.now() - new Date(lastUpdate).getTime();
  if (age > OFFLINE_THRESHOLD_MS || deviceStatus === 'offline') return 'offline';
  // GPS antigo + device online ⇒ rastreador mandando só heartbeat. Tratar
  // como parado, ignorando o speed antigo travado.
  const positionAge = positionTime
    ? Date.now() - new Date(positionTime).getTime()
    : Infinity;
  if (positionAge > STALE_POSITION_MS) return 'stopped';
  if (speed > 0 && deviceStatus === 'online') return 'moving';
  return 'stopped';
}
