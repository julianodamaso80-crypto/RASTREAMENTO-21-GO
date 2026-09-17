/** Consultor espelhado do Power CRM, com a ficha inteira. Endereço não existe no Power. */
export interface Consultant {
  id: string;
  powerId: number;
  name: string;
  /** Nome de tratamento no Power. */
  nickname: string | null;
  email: string | null;
  /** Só dígitos: CPF (11) ou CNPJ (14). */
  document: string | null;
  /** Só dígitos. */
  phone: string | null;
  mobile: string | null;
  office: number | null;
  officeLabel: string | null;
  branch: string | null;
  cooperative: string | null;
  permissionGroup: string | null;
  managerName: string | null;
  active: boolean;
  statusLabel: string | null;
  powerCreatedAt: string | null;
  lastAccessAt: string | null;
  blockedAt: string | null;
}

export type ConsultantStatusFilter = 'ativo' | 'bloqueado';

export interface ConsultantBase {
  items: Consultant[];
  lastSyncAt: string | null;
  syncing: boolean;
}

export interface ConsultantSyncStatus {
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastTotal: number | null;
}
