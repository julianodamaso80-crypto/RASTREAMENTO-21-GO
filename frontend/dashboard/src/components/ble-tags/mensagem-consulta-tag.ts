import { formatRelativeTime } from '@/lib/utils';

/**
 * O que dizer ao operador quando a consulta "Atualizar TAG" termina.
 *
 * "8 avistamento(s) novo(s)" mentia por omissão: a Apple devolve 7 dias a cada
 * consulta, então "novo" quase sempre é ponto antigo que ainda não tínhamos —
 * e a tela não muda nada (dono, 30/09/2026: "apareceu 8 avistamentos mas nada
 * foi mostrado"). O que importa é UMA pergunta: a rede viu a TAG depois do que
 * já estava na tela?
 */
export interface ResultadoConsulta {
  avistamentosNovos: number | null;
  avistamentoMaisRecenteEm: string | null;
}

export function mensagemDaConsulta(
  r: ResultadoConsulta,
  vistaAntesEm: string | null,
  agora: number = Date.now(),
): { tipo: 'success' | 'info'; texto: string } {
  const recente = r.avistamentoMaisRecenteEm
    ? new Date(r.avistamentoMaisRecenteEm).getTime()
    : null;
  const antes = vistaAntesEm ? new Date(vistaAntesEm).getTime() : null;

  if (recente !== null && (antes === null || recente > antes)) {
    return {
      tipo: 'success',
      texto: `A rede viu a TAG de novo: avistamento ${relativo(recente, agora)}.`,
    };
  }

  const desde = antes !== null ? ` desde ${relativo(antes, agora).replace(/^há /, '')} atrás` : '';
  const pontosVelhos =
    r.avistamentosNovos && r.avistamentosNovos > 0
      ? ` (vieram ${r.avistamentosNovos} pontos antigos do histórico, nada mais novo)`
      : '';
  return {
    tipo: 'info',
    texto: `A rede respondeu, mas nenhum iPhone passou perto da TAG${desde}${pontosVelhos}.`,
  };
}

function relativo(ms: number, agora: number): string {
  const diff = agora - ms;
  if (diff < 60_000) return 'agora';
  return formatRelativeTime(new Date(ms).toISOString());
}
