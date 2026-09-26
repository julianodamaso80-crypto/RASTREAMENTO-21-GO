export const FINANCIAL_STATUSES = ['MIGRATION', 'PAID_PIX', 'NO_RECEIPT'] as const;
export type FinancialStatus = (typeof FINANCIAL_STATUSES)[number];

/** Rótulos da planilha do financeiro — usados no PDF do relatório. */
export const FINANCIAL_STATUS_LABEL: Record<string, string> = {
  MIGRATION: 'MIGRAÇÃO',
  PAID_PIX: 'PAGO - PIX',
  NO_RECEIPT: 'SEM COMPROVANTE',
};

export const MESES = [
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
];
