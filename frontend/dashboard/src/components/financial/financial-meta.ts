import type { FinancialStatus } from '@/types/financial';

/** Mesmas três opções e cores da planilha do financeiro. */
export const FINANCIAL_STATUS_META: Record<
  FinancialStatus,
  { label: string; from: string; to: string; edge: string; text: string }
> = {
  MIGRATION: { label: 'MIGRAÇÃO', from: '#b6e36a', to: '#8bc34a', edge: '#5f8f24', text: '#1f3a08' },
  PAID_PIX: { label: 'PAGO - PIX', from: '#34d27a', to: '#16a34a', edge: '#0d6b31', text: '#ffffff' },
  NO_RECEIPT: { label: 'SEM COMPROVANTE', from: '#ff8a3d', to: '#ea580c', edge: '#9a3412', text: '#ffffff' },
};

export const FINANCIAL_STATUS_ORDER: FinancialStatus[] = ['MIGRATION', 'PAID_PIX', 'NO_RECEIPT'];

export const MONTHS = [
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
];
