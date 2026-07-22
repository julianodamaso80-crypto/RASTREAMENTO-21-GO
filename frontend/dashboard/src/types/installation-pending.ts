export type PendingType = 'TRACKER' | 'TAG';

export interface InstallationPending {
  id: string;
  /** Vazia em veículo aguardando emplacamento — nesse caso vale o chassi. */
  plate: string;
  chassi: string | null;
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

/** Resposta imediata do POST /sync — a varredura roda em background. */
export interface InstallationPendingSyncStart {
  started: boolean;
  alreadyRunning: boolean;
}

export interface InstallationPendingSyncStatus {
  syncing: boolean;
  startedAt: string | null;
  elapsedSeconds: number | null;
  last: InstallationPendingSyncResult | null;
  lastError: string | null;
}

export interface InstallationPendingFilters {
  days: number;
  type?: PendingType;
  city?: string;
  search?: string;
}
