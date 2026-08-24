/**
 * Decide com que pressa cada TAG é consultada na rede Find My.
 *
 * A TAG existe para o cenário em que o rastreador principal foi neutralizado:
 * bloqueador de sinal não desliga o Bluetooth dela. Por isso o gatilho do
 * ritmo acelerado são justamente os alertas de rastreador mudo.
 */

/** Alertas que indicam rastreador principal neutralizado ou mudo. */
export const ALERTAS_QUE_ACELERAM = [
  'OFFLINE',
  'GPS_SILENT',
  'JAMMING',
  'POWER_CUT',
];

// Zero significa "não consultar": em repouso a TAG não entra no plano do
// worker (ver getPollingPlan). Assim o tamanho da frota deixa de importar —
// só custa requisição a TAG com ocorrência aberta.
export const INTERVALO_IDLE_S = 0;

// O autor da FindMy.py mediu na prática: consultar a cada 5-10min bane a
// conta Apple; a cada 15-30min é seguro (issue #99). A latência real da rede
// Find My já é de 1-15min, então consultar mais rápido que isso não traz
// quase nada — 30min é o piso seguro medido.
export const INTERVALO_TURBO_S = 1800;

/**
 * A Apple guarda 7 dias de relatórios. Ao entrar em TURBO puxamos a janela
 * inteira de uma vez — é por isso que não precisamos consultar o tempo todo
 * só para ter histórico.
 */
export const BACKFILL_TURBO_H = 168;

/** Duração do acionamento manual feito pelo operador. */
export const TURBO_MANUAL_H = 6;

export type ModoPolling = 'IDLE' | 'TURBO';

export interface EntradaModo {
  alertasAbertos: string[];
  turboUntil: Date | null;
  agora: Date;
}

export interface ResultadoModo {
  modo: ModoPolling;
  intervalSeconds: number;
  backfillHours: number;
}

export function decidirModo(entrada: EntradaModo): ResultadoModo {
  const porAlerta = entrada.alertasAbertos.some((a) =>
    ALERTAS_QUE_ACELERAM.includes(a),
  );
  const porOperador =
    entrada.turboUntil !== null && entrada.turboUntil > entrada.agora;

  if (porAlerta || porOperador) {
    return {
      modo: 'TURBO',
      intervalSeconds: INTERVALO_TURBO_S,
      backfillHours: BACKFILL_TURBO_H,
    };
  }

  return {
    modo: 'IDLE',
    intervalSeconds: INTERVALO_IDLE_S,
    backfillHours: 0,
  };
}
