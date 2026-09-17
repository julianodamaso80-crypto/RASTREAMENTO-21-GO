import type { FinancialStatus } from '@/types/financial';

/** Mesmas três opções e cores da planilha do financeiro. */
export const FINANCIAL_STATUS_META: Record<
  FinancialStatus,
  { label: string; bg: string; text: string }
> = {
  MIGRATION: { label: 'MIGRAÇÃO', bg: '#92d050', text: '#1f3a08' },
  PAID_PIX: { label: 'PAGO - PIX', bg: '#00b050', text: '#ffffff' },
  NO_RECEIPT: { label: 'SEM COMPROVANTE', bg: '#f26b1d', text: '#ffffff' },
};

export const FINANCIAL_STATUS_ORDER: FinancialStatus[] = ['MIGRATION', 'PAID_PIX', 'NO_RECEIPT'];

export const MONTHS = [
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
];
