/**
 * Normalização do que o SGA devolve em `situacao_financeira` e
 * `descricao_situacao_veiculo`.
 *
 * O SGA não tem enum estável nesses campos: já apareceram acentos, caixa mista
 * e descrições compostas. O card só pode pintar "Em dia" em verde quando tem
 * certeza — na dúvida devolve null e a tela diz "situação não consultada", que
 * é honesto. Inventar "em dia" para um inadimplente é pior que não mostrar.
 */

export type FinancialStatus = 'ADIMPLENTE' | 'INADIMPLENTE';

function normalize(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

export function normalizeFinancialStatus(
  raw: string | null | undefined,
): FinancialStatus | null {
  if (!raw) return null;
  const s = normalize(raw);
  if (!s) return null;
  // A ordem importa: "INADIMPLENTE" contém "ADIMPLENTE".
  if (s.includes('INADIMPL')) return 'INADIMPLENTE';
  if (s.includes('ADIMPL') || s.includes('EM DIA')) return 'ADIMPLENTE';
  return null;
}

/** Descrição da situação do veículo no SGA (ATIVO, CANCELADO, SUBSTITUIDO...). */
export function normalizeSgaStatusLabel(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const s = normalize(raw);
  return s || null;
}
