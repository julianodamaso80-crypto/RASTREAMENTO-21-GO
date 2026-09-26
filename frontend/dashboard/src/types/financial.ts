export type FinancialStatus = 'MIGRATION' | 'PAID_PIX' | 'NO_RECEIPT';

export interface FinancialEntry {
  id: string;
  plate: string;
  status: FinancialStatus;
  month: number | null;
  consultantName: string | null;
  consultantContact: string | null;
  receiptId: string | null;
  plateCount: number;
  createdAt: string;
  updatedAt: string;
  /** Comprovante anexado (imagem ou PDF). Null = ainda não anexaram. */
  receipt: {
    fileName: string;
    mimeType: string;
    size: number;
    createdAt: string;
  } | null;
}

export type FinancialEntryPayload = Partial<
  Pick<
    FinancialEntry,
    'plate' | 'status' | 'month' | 'consultantName' | 'consultantContact' | 'receiptId' | 'plateCount'
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

export interface ConsultantOption {
  id: string;
  name: string;
  mobile: string | null;
  phone: string | null;
  active: boolean;
}
