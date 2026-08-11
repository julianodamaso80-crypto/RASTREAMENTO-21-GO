/**
 * Estado de comunicação do ativo. Calculado no backend (`asset-comms.ts`) pra
 * que a regra que separa "chip vivo" de "veículo localizado" exista num lugar
 * só.
 */
export type CommsState = 'OK' | 'GPS_CONGELADO' | 'MUDO' | 'NUNCA';

export interface CommsAssessment {
  state: CommsState;
  gprsAgeMinutes: number | null;
  gpsAgeMinutes: number | null;
}

export type FinancialStatus = 'ADIMPLENTE' | 'INADIMPLENTE';

/** Um ativo na tela de Clientes Ativos — um veículo com cliente vinculado. */
export interface ClientAsset {
  id: string;
  plate: string;
  brand: string | null;
  model: string | null;
  vehicleType: 'CAR' | 'MOTORCYCLE';
  chassi: string | null;
  status: string;
  createdAt: string;
  associate: {
    id: string;
    name: string;
    cpf: string;
    phone: string | null;
    email: string | null;
  } | null;
  device: {
    id: string;
    imei: string;
    model: string;
    status: string;
    installedAt: string | null;
    installLocation: string | null;
    /** GPRS — o chip respirou. Não prova localização. */
    lastConnection: string | null;
    technician: { id: string; name: string } | null;
    installedByName: string | null;
  } | null;
  /** GPS — o único carimbo que prova onde o veículo estava. */
  lastFixTime: string | null;
  comms: CommsAssessment;
  financialStatus: FinancialStatus | null;
  financialStatusAt: string | null;
  appAccessBlocked: boolean;
  sga: { code: string | null; statusLabel: string | null };
}

export interface AssetsSummary {
  total: number;
  byType: Array<{ type: 'CAR' | 'MOTORCYCLE'; count: number; pct: number }>;
  byMonth: Array<{ month: string; count: number }>;
  week: {
    offset: number;
    from: string;
    to: string;
    total: number;
    days: Array<{
      date: string;
      count: number;
      items: Array<{
        vehicleId: string;
        plate: string;
        brand: string | null;
        model: string | null;
        vehicleType: string;
        imei: string;
        associateName: string | null;
        technicianName: string | null;
      }>;
    }>;
  };
}
