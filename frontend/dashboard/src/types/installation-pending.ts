export type PendingType = 'TRACKER' | 'TAG';

export interface InstallationPending {
  id: string;
  plate: string;
  pendingType: PendingType;
  associateName: string;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  brandModel: string;
  vehicleType: string | null;
  city: string | null;
  neighborhood: string | null;
  protectedValue: number;
  /** yyyy-mm-dd */
  contractDate: string;
  daysPending: number;
  evaluationTable: string | null;
  consultantName: string | null;
  hinovaVehicleCode: string;
}

export interface InstallationPendingStats {
  total: number;
  tracker: number;
  tag: number;
  exposedValue: number;
  lastSyncAt: string | null;
  syncing: boolean;
}

export interface InstallationPendingSyncResult {
  started: boolean;
  tracker: number;
  tag: number;
  total: number;
  duration: string;
}

export interface InstallationPendingFilters {
  days: number;
  type?: PendingType;
  city?: string;
  search?: string;
}
