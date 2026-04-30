import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { DisplayStatus } from '@/types/vehicle';
import { OFFLINE_THRESHOLD_MS } from './constants';

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

export function getDisplayStatus(
  deviceStatus: string,
  speed: number,
  lastUpdate: string,
  vehicleStatus: string,
): DisplayStatus {
  if (vehicleStatus === 'BLOCKED') return 'alert';
  const age = Date.now() - new Date(lastUpdate).getTime();
  if (age > OFFLINE_THRESHOLD_MS || deviceStatus === 'offline') return 'offline';
  if (speed > 0 && deviceStatus === 'online') return 'moving';
  return 'stopped';
}
