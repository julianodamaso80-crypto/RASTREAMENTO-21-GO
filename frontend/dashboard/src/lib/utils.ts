import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { DisplayStatus, VehicleType } from '@/types/vehicle';
import {
  ONLINE_ATE_MS,
  SEM_RESP_ATE_MS,
  SLEEP_MOTO_ATE_MS,
  STALE_POSITION_MS,
  STATUS_LABELS,
} from './constants';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function maskCPF(cpf: string): string {
  if (!cpf || cpf.length < 11) return cpf || '';
  return `***.***.*${cpf.slice(-4, -2)}-${cpf.slice(-2)}`;
}

/**
 * CPF/CNPJ com a pontuação de sempre, sem esconder dígito.
 *
 * Usado nas telas do time interno (Clientes Ativos), onde o documento serve
 * para conferir com quem está no telefone — mascarado ele não confere nada.
 * Para o que o cliente final enxerga existe `maskCPF`.
 */
export function formatCpfCnpj(doc: string | null | undefined): string {
  const d = (doc ?? '').replace(/\D/g, '');
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return doc ?? '';
}

export function formatSpeed(knots: number): string {
  const kmh = knots * 1.852;
  return `${Math.round(kmh)} km/h`;
}

export function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  if (!Number.isFinite(diff)) return 'nunca comunicou';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'agora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

/**
 * "Última atualização há 6 dias" — o texto do card da RedeVeiculos, que usa
 * `moment().fromNow()` em pt-br. Mesmos degraus do moment.
 */
export function ultimaAtualizacao(isoDate: string): string {
  const s = (Date.now() - new Date(isoDate).getTime()) / 1000;
  if (!Number.isFinite(s)) return 'Última atualização não informada';
  const m = s / 60;
  const h = m / 60;
  const d = h / 24;
  let txt: string;
  if (s < 45) txt = 'há poucos segundos';
  else if (s < 90) txt = 'há um minuto';
  else if (m < 45) txt = `há ${Math.round(m)} minutos`;
  else if (m < 90) txt = 'há uma hora';
  else if (h < 22) txt = `há ${Math.round(h)} horas`;
  else if (h < 36) txt = 'há um dia';
  else if (d < 26) txt = `há ${Math.round(d)} dias`;
  else if (d < 45) txt = 'há um mês';
  else if (d < 320) txt = `há ${Math.round(d / 30.4)} meses`;
  else if (d < 548) txt = 'há um ano';
  else txt = `há ${Math.round(d / 365)} anos`;
  return `Última atualização ${txt}`;
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
 * Estado da comunicação do rastreador, com a régua da RedeVeiculos
 * (`colorIconAtivoGPSAndSinal` do mapa deles, lido em 07/10/2026):
 *
 *  alert    — VehicleStatus=BLOCKED
 *  sem_gps  — comunicou há até 60 min, mas não há posição GPS nenhuma
 *  online   — comunicou há até 30 min
 *  sem_resp — comunicou há 30–60 min
 *  sleep    — moto calada há menos de 2 dias
 *  offline  — o resto
 *
 * "Comunicou" é o último sinal de vida do rastreador (Traccar `lastUpdate`,
 * que anda com heartbeat), não a última posição GPS: carro parado mandando
 * heartbeat continua ONLINE, como na Rede. O `status` do Traccar não entra —
 * ele diz "offline" toda vez que a conexão TCP fecha e o GT06 fecha e reabre o
 * tempo todo.
 */
export function getDisplayStatus(v: {
  lastUpdate: string;
  positionTime: string | null;
  latitude: number;
  longitude: number;
  vehicleStatus: string;
  vehicleType: VehicleType;
}): DisplayStatus {
  if (v.vehicleStatus === 'BLOCKED') return 'alert';
  const contatoAgeMs = Date.now() - new Date(v.lastUpdate).getTime();
  if (!Number.isFinite(contatoAgeMs)) return 'offline';
  if (contatoAgeMs <= SEM_RESP_ATE_MS) {
    const temPosicao = !!v.positionTime && !(v.latitude === 0 && v.longitude === 0);
    if (!temPosicao) return 'sem_gps';
    return contatoAgeMs <= ONLINE_ATE_MS ? 'online' : 'sem_resp';
  }
  if (v.vehicleType === 'MOTORCYCLE' && contatoAgeMs < SLEEP_MOTO_ATE_MS) return 'sleep';
  return 'offline';
}

/** Rastreador falando com o servidor agora (na Rede: `status_sinal` = R). */
export function estaConectado(status: DisplayStatus): boolean {
  return status === 'online' || status === 'sem_resp' || status === 'sem_gps';
}

/**
 * Em movimento SÓ se o GPS está atualizando (posição fresca) E com velocidade.
 * Concox/GT06 param de mandar GPS quando o carro fica parado, congelando a
 * última velocidade ("6 km/h" travado por horas): posição velha = parado.
 */
const MOVING_KNOTS = 1; // ~1.8 km/h — acima disso é movimento real (evita drift)
export function estaAndando(speed: number, positionTime: string | null): boolean {
  if (!positionTime) return false;
  const positionAge = Date.now() - new Date(positionTime).getTime();
  return positionAge < STALE_POSITION_MS && speed > MOVING_KNOTS;
}

/** Selo do status, com os mesmos nomes da Rede (ONLINE, OFFLINE, ...). */
export function getVehicleStatusLabel(status: DisplayStatus): string {
  return STATUS_LABELS[status];
}

/** Ignição como a Rede mostra: só quando o rastreador está conectado. */
export function ignicaoTexto(status: DisplayStatus, ignition: boolean): string {
  if (!estaConectado(status)) return '--';
  return ignition ? 'Ligada' : 'Desligada';
}
