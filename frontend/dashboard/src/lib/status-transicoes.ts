import type { VehicleType } from '@/types/vehicle';
import {
  ONLINE_ATE_MS,
  SEM_RESP_ATE_MS,
  SLEEP_MOTO_ATE_MS,
  STALE_POSITION_MS,
} from './constants';

/**
 * Instante (ms) da próxima mudança de status ou de movimento que depende só do
 * relógio — os limiares de `getDisplayStatus` e `estaAndando`. `null` quando
 * nenhum limiar futuro se aplica. Limiar com `<=` vira 1 ms depois; com `<`,
 * no próprio instante.
 */
export function proximaTransicaoEm({
  lastUpdate,
  positionTime,
  vehicleType,
  agora,
}: {
  lastUpdate: string;
  positionTime: string | null;
  vehicleType: VehicleType;
  agora: number;
}): number | null {
  const candidatos: number[] = [];
  const contato = new Date(lastUpdate).getTime();
  if (Number.isFinite(contato)) {
    if (positionTime) candidatos.push(contato + ONLINE_ATE_MS + 1);
    candidatos.push(contato + SEM_RESP_ATE_MS + 1);
    if (vehicleType === 'MOTORCYCLE') candidatos.push(contato + SLEEP_MOTO_ATE_MS);
  }
  if (positionTime) {
    const fix = new Date(positionTime).getTime();
    if (Number.isFinite(fix)) candidatos.push(fix + STALE_POSITION_MS);
  }
  let proximo: number | null = null;
  for (const t of candidatos) if (t > agora && (proximo === null || t < proximo)) proximo = t;
  return proximo;
}
