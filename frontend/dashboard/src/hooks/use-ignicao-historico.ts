'use client';

import { useEffect, useState } from 'react';
import { traccarApi } from '@/lib/api';
import type { IgnicaoLeitura } from '@/types/vehicle';

/** Janela de busca: mais velho que isso não é leitura que valha mostrar. */
const JANELA_MS = 24 * 60 * 60 * 1000;

/**
 * Última leitura real da chave para devices cuja posição atual não traz o
 * campo `ignition` (só o "estou vivo"). Busca o histórico UMA vez por device
 * e guarda; `null` = nem o histórico informou, a tela mostra "--".
 *
 * Só para os marcados (poucos): varrer o histórico da frota inteira seria
 * centenas de chamadas.
 */
export function useIgnicaoHistorico(deviceIds: number[]) {
  const [leituras, setLeituras] = useState<Map<number, IgnicaoLeitura | null>>(
    () => new Map(),
  );
  const chave = deviceIds.join(',');

  useEffect(() => {
    const faltam = chave
      .split(',')
      .filter(Boolean)
      .map(Number)
      .filter((id) => !leituras.has(id));
    if (faltam.length === 0) return;
    let cancelado = false;
    const ate = new Date();
    const de = new Date(ate.getTime() - JANELA_MS);
    void Promise.all(
      faltam.map(async (id): Promise<[number, IgnicaoLeitura | null]> => {
        try {
          const posicoes = await traccarApi.getHistory(id, de.toISOString(), ate.toISOString());
          let achada: IgnicaoLeitura | null = null;
          for (const p of posicoes) {
            const valor = p.attributes?.ignition;
            if (typeof valor !== 'boolean') continue;
            if (!achada || p.serverTime > achada.em) achada = { ligada: valor, em: p.serverTime };
          }
          return [id, achada];
        } catch {
          return [id, null];
        }
      }),
    ).then((resultados) => {
      if (cancelado) return;
      setLeituras((antes) => {
        const proximo = new Map(antes);
        for (const [id, leitura] of resultados) proximo.set(id, leitura);
        return proximo;
      });
    });
    return () => {
      cancelado = true;
    };
  }, [chave, leituras]);

  return leituras;
}
