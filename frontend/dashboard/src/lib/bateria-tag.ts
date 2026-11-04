/**
 * Bateria da TAG (rede Find My). O relatório traz um byte de status cujos
 * bits 6-7 são o estado da bateria; o backend guarda o byte cru e devolve o
 * nível já derivado (`bateria`). Esta função repete a conta para telas que só
 * têm o byte. Mesma regra do MonitoraBem.
 */
export type NivelBateria = 'CHEIA' | 'MEDIA' | 'BAIXA' | 'CRITICA';

const NIVEIS: readonly NivelBateria[] = ['CHEIA', 'MEDIA', 'BAIXA', 'CRITICA'];

export function nivelBateria(statusByte: number | null | undefined): NivelBateria | null {
  if (statusByte == null || !Number.isInteger(statusByte) || statusByte < 0 || statusByte > 255) return null;
  return NIVEIS[(statusByte >> 6) & 3];
}

const ROTULOS: Record<NivelBateria, string> = {
  CHEIA: 'Cheia',
  MEDIA: 'Média',
  BAIXA: 'Baixa',
  CRITICA: 'Crítica',
};

export function rotuloBateria(nivel: NivelBateria | null | undefined): string {
  return nivel ? ROTULOS[nivel] : '—';
}

const CORES: Record<NivelBateria, string> = {
  CHEIA: 'text-emerald-400',
  MEDIA: 'text-amber-400',
  BAIXA: 'text-orange-400',
  CRITICA: 'text-red-400',
};

export function corBateria(nivel: NivelBateria | null | undefined): string {
  return nivel ? CORES[nivel] : 'text-slate-400';
}

export function dicaBateria(nivel: NivelBateria | null | undefined): string {
  return nivel ? `Bateria ${rotuloBateria(nivel).toLowerCase()}` : 'A rede ainda não informou a bateria desta TAG';
}

/** Byte cru para calibração, só para a equipe (nunca para o cliente). */
export function textoStatusCru(statusByte: number | null | undefined): string | null {
  if (statusByte == null || !Number.isInteger(statusByte)) return null;
  return `status 0x${statusByte.toString(16).padStart(2, '0')}`;
}
