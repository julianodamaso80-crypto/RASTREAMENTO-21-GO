export type DashboardPeriod = 'today' | '7d' | '30d';

export interface DashboardKpi<T = number> {
  value: T;
}

export interface DashboardOverview {
  period: DashboardPeriod;
  generatedAt: string;
  kpis: {
    totalVehicles: { value: number; diffMonth: number | null };
    onlineNow: { value: number; percentOfTotal: number };
    offlineOver1h: { value: number };
    alerts24h: { value: number; byType: Record<string, number> };
    kmInPeriod: { value: number };
    criticalOpen: { value: number };
    lowBattery: { value: number };
    noCommOver24h: { value: number };
  };
  charts: {
    alertsTimeSeries: { label: string; count: number }[];
    fleetStatus: { online: number; offline: number; alerta: number };
    topKmVehicles: { vehicleId: string | null; plate: string; km: number }[];
  };
  tables: {
    recentEvents: {
      id: string;
      type: string;
      message: string;
      vehicleId: string;
      plate: string | null;
      createdAt: string;
    }[];
    needsAttention: {
      vehicleId: string;
      plate: string;
      reason: string;
      lastSeen: string | null;
    }[];
  };
  meta: {
    alertsInPeriod: number;
    deviceCount: number;
  };
}

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  today: 'Hoje',
  '7d': '7 dias',
  '30d': '30 dias',
};
