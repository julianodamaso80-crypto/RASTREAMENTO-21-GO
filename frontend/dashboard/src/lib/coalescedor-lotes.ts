import type { TraccarDevice, TraccarPosition } from '@/types/traccar';
import type { AtributosItem } from '@/lib/tracking-polling';

/** O que chegou do socket no mesmo tique, entregue de uma vez. */
export interface LoteTempoReal {
  positions: TraccarPosition[];
  devices: TraccarDevice[];
  atributos: AtributosItem[];
}

/**
 * `positions:batch`, `devices:batch` e `attrs:batch` saem juntos a cada segundo,
 * mas chegam como mensagens separadas: juntá-los num `setTimeout(0)` faz um
 * único render por segundo em vez de três.
 */
export function criarCoalescedorDeLotes(flush: (lote: LoteTempoReal) => void) {
  let lote: LoteTempoReal = { positions: [], devices: [], atributos: [] };
  let timer: ReturnType<typeof setTimeout> | null = null;

  const descarregar = () => {
    timer = null;
    const pronto = lote;
    lote = { positions: [], devices: [], atributos: [] };
    flush(pronto);
  };
  const agendar = () => {
    if (timer === null) timer = setTimeout(descarregar, 0);
  };

  return {
    positions(itens: TraccarPosition[]) {
      lote.positions.push(...itens);
      agendar();
    },
    devices(itens: TraccarDevice[]) {
      lote.devices.push(...itens);
      agendar();
    },
    atributos(itens: AtributosItem[]) {
      lote.atributos.push(...itens);
      agendar();
    },
    cancelar() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      lote = { positions: [], devices: [], atributos: [] };
    },
  };
}
