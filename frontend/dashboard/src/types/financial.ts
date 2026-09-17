export type FinancialStatus = 'MIGRATION' | 'PAID_PIX' | 'NO_RECEIPT';

export interface FinancialEntry {
  id: string;
  plate: string;
  status: FinancialStatus;
  month: number | null;
  consultantName: string | null;
  receiptId: string | null;
  plateCount: number;
  createdAt: string;
  updatedAt: string;
}

export type FinancialEntryPayload = Partial<
  Pick<
    FinancialEntry,
    'plate' | 'status' | 'month' | 'consultantName' | 'receiptId' | 'plateCount'
  >
>;

export interface FinancialFilter {
  search?: string;
  status?: FinancialStatus | '';
  month?: number | '';
  /** ISO, inclusivo. */
  from?: string;
  /** ISO, exclusivo. */
  to?: string;
}
