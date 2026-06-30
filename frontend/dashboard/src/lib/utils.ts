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

/**
 * Calcula o status visível do veículo — 3 estados que o dono entende:
 *
 *  alert        — VehicleStatus=BLOCKED (bloqueado manualmente)
 *  offline      — rastreador parou de comunicar (heartbeat >10min OU
 *                 device.status='offline') → "GPS com defeito", VERMELHO
 *  ignition_on  — rastreador comunicando + motor LIGADO   → VERDE,   "Ligado"
 *  ignition_off — rastreador comunicando + motor DESLIGADO → LARANJA, "Desligado"
 *
 * IMPORTANTE: posição GPS velha NÃO é mais "defeito". Rastreadores GT06/Concox
 * param de mandar GPS quando o carro fica parado, mas continuam ONLINE
 * (heartbeat). Carro parado/desligado é estado normal, não problema — o que
 * importa pro defeito é o rastreador SUMIR (parar de comunicar de vez).
 * O `positionTime` segue no parâmetro só por compatibilidade de chamada.
 */
export function getDisplayStatus(
  deviceStatus: string,
  _speed: number,
  lastUpdate: string,
  vehicleStatus: string,
  _positionTime: string | null = null,
  ignition: boolean = false,
): DisplayStatus {
  if (vehicleStatus === 'BLOCKED') return 'alert';
  const age = Date.now() - new Date(lastUpdate).getTime();
  // rastreador sumiu (sem comunicação) = GPS com defeito
  if (age > OFFLINE_THRESHOLD_MS || deviceStatus === 'offline') return 'offline';
  // rastreador comunicando → estado pela ignição
  return ignition ? 'ignition_on' : 'ignition_off';
}

/**
 * Label do status para um veículo específico, com o tipo (carro/moto) e
 * concordância de gênero. Usado no painel e na lista.
 */
export function getVehicleStatusLabel(
  status: DisplayStatus,
  vehicleType: 'CAR' | 'MOTORCYCLE',
): string {
  const moto = vehicleType === 'MOTORCYCLE';
  switch (status) {
    case 'ignition_on':
      return moto ? 'Moto ligada' : 'Carro ligado';
    case 'ignition_off':
      return moto ? 'Moto desligada' : 'Carro desligado';
    case 'offline':
      return 'GPS com defeito';
    case 'alert':
      return 'Bloqueado';
  }
}
