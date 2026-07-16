export interface StockItem {
  id: string;
  imei: string;
  iccid: string | null;
  line: string | null;
  operator: string | null;
  status: string | null;
  server: string | null;
  registeredAt: string | null;
  activatedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StockImportResult {
  imported: number;
  updated: number;
  skipped: number;
  total: number;
}

export interface StockStats {
  total: number;
  byStatus: Array<{ status: string; count: number }>;
}
