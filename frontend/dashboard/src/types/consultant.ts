/** Consultor espelhado do Power CRM. Endereço não existe no Power. */
export interface ConsultantListItem {
  id: string;
  name: string;
  email: string | null;
  /** Só dígitos. */
  mobile: string | null;
  phone: string | null;
  officeLabel: string | null;
  cooperative: string | null;
  active: boolean;
  statusLabel: string | null;
}

export interface ConsultantDetail extends ConsultantListItem {
  powerId: number;
  nickname: string | null;
  /** Só dígitos: CPF (11) ou CNPJ (14). */
  document: string | null;
  office: number | null;
  branch: string | null;
  permissionGroup: string | null;
  managerName: string | null;
  powerCreatedAt: string | null;
  lastAccessAt: string | null;
  blockedAt: string | null;
  syncedAt: string;
}

export type ConsultantStatusFilter = 'ativo' | 'bloqueado';

export interface ConsultantFilters {
  search?: string;
  status?: ConsultantStatusFilter;
  office?: number;
  page?: number;
}

export interface ConsultantList {
  items: ConsultantListItem[];
  total: number;
  page: number;
  pageSize: number;
  stats: { active: number; blocked: number };
  offices: { office: number; label: string; count: number }[];
  lastSyncAt: string | null;
  syncing: boolean;
}

export interface ConsultantSyncStatus {
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastTotal: number | null;
}
