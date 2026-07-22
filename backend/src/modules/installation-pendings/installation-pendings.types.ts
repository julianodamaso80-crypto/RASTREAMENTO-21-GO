export type PendingType = 'TRACKER' | 'TAG';

export interface PendingListQuery {
  /** Janela em dias sobre a data de contrato. */
  days: number;
  type?: PendingType;
  city?: string;
  search?: string;
  limit?: number;
}

export interface InstallationPendingRow {
  id: string;
  /** Vazia em veículo aguardando emplacamento — nesse caso use o `chassi`. */
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

export interface PendingStats {
  total: number;
  tracker: number;
  tag: number;
  /** Soma do valor protegido dos veículos sem equipamento instalado. */
  exposedValue: number;
  lastSyncAt: string | null;
  syncing: boolean;
}

export interface SyncOutcome {
  /** true quando havia um sync em andamento e este disparo foi ignorado. */
  started: boolean;
  tracker: number;
  tag: number;
  total: number;
  duration: string;
}
