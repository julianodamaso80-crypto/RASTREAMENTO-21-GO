export const FINANCIAL_STATUSES = ['MIGRATION', 'PAID_PIX', 'NO_RECEIPT'] as const;
export type FinancialStatus = (typeof FINANCIAL_STATUSES)[number];
