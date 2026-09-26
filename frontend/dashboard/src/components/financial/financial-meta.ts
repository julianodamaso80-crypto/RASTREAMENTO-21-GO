import type { FinancialStatus } from '@/types/financial';

/**
 * As três opções da planilha do financeiro, no tom suave dos selos do Estoque.
 * `emerald` no tema é o laranja da marca: verde de verdade aqui é `green`.
 */
export const FINANCIAL_STATUS_META: Record<
  FinancialStatus,
  { label: string; badge: string; dot: string }
> = {
  MIGRATION: {
    label: 'MIGRAÇÃO',
    badge: 'bg-lime-500/15 text-lime-700 border-lime-500/40',
    dot: 'bg-lime-500',
  },
  PAID_PIX: {
    label: 'PAGO - PIX',
    badge: 'bg-green-600/15 text-green-700 border-green-600/40',
    dot: 'bg-green-600',
  },
  NO_RECEIPT: {
    label: 'SEM COMPROVANTE',
    badge: 'bg-orange-500/15 text-orange-700 border-orange-500/40',
    dot: 'bg-orange-500',
  },
};

export const FINANCIAL_STATUS_ORDER: FinancialStatus[] = ['MIGRATION', 'PAID_PIX', 'NO_RECEIPT'];

export const MONTHS = [
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
];

/** Celular só com dígitos → (21) 99834-5046. Formato desconhecido volta como veio. */
export function formatContato(valor: string | null | undefined): string {
  const d = (valor ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return valor ?? '';
}
