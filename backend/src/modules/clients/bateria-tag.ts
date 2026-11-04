export type NivelBateria = 'CHEIA' | 'MEDIA' | 'BAIXA' | 'CRITICA';

const NIVEIS: readonly NivelBateria[] = ['CHEIA', 'MEDIA', 'BAIXA', 'CRITICA'];

/**
 * Bateria da TAG a partir do byte de status do relatório Find My: bits 6-7
 * (0 cheia, 1 média, 2 baixa, 3 crítica) — mesma regra do MonitoraBem. O byte
 * cru é o que fica no banco; o rótulo se deriva aqui. Sem byte, não sabemos.
 */
export function nivelBateria(statusByte: number | null | undefined): NivelBateria | null {
  if (statusByte == null || !Number.isInteger(statusByte) || statusByte < 0 || statusByte > 255) return null;
  return NIVEIS[(statusByte >> 6) & 3];
}
