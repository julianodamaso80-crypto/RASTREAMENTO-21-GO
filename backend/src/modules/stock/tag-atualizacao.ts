/**
 * Regras de tempo do "Atualizar TAG" — copiadas do aviso da própria
 * RedeVeiculos ("Instruções sobre a Tag", lido em 16/09/2026):
 *
 *   "Ao adicionar uma Tag no mapa, a localização é atualizada automaticamente
 *    a cada 15 minutos. Caso deseje, você pode forçar uma atualização manual a
 *    cada 3 minutos clicando no botão indicado. Para duas ou mais Tags, a
 *    atualização será somente manual a cada 3 minutos."
 *
 * A trava não é enfeite: cada atualização é uma consulta à conta Apple do dono,
 * que é o ativo mais frágil da coleta — consultar demais derruba TODAS as TAGs.
 */

/** Espera entre duas atualizações manuais da MESMA TAG. */
export const ESPERA_MANUAL_MS = 3 * 60_000;
/** Ciclo automático quando há UMA TAG aberta no mapa. */
export const CICLO_AUTOMATICO_MS = 15 * 60_000;

export interface EstadoAtualizacao {
  pode: boolean;
  /** Quando a próxima atualização manual fica liberada. */
  disponivelEm: Date;
  segundosRestantes: number;
}

export function estadoAtualizacaoTag(
  ultimaSolicitacao: Date | null,
  agora: Date = new Date(),
): EstadoAtualizacao {
  if (!ultimaSolicitacao) {
    return { pode: true, disponivelEm: agora, segundosRestantes: 0 };
  }
  const disponivelEm = new Date(ultimaSolicitacao.getTime() + ESPERA_MANUAL_MS);
  const faltaMs = disponivelEm.getTime() - agora.getTime();
  return {
    pode: faltaMs <= 0,
    disponivelEm,
    segundosRestantes: Math.max(0, Math.ceil(faltaMs / 1000)),
  };
}
