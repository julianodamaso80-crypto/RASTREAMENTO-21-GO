export type AlertType =
  | 'SPEED'
  | 'IGNITION_ON'
  | 'IGNITION_OFF'
  | 'SOS'
  | 'BATTERY_LOW'
  | 'OFFLINE'
  | 'GEOFENCE_IN'
  | 'GEOFENCE_OUT';

export interface Alert {
  id: string;
  type: AlertType;
  message: string;
  data: Record<string, unknown> | null;
  read: boolean;
  vehicleId: string;
  vehicle?: {
    plate: string;
    brand: string | null;
    model: string | null;
    color?: string | null;
  };
  tenantId: string;
  createdAt: string;
}

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  SPEED: 'Velocidade',
  IGNITION_ON: 'Ignição Ligada',
  IGNITION_OFF: 'Ignição Desligada',
  SOS: 'SOS',
  BATTERY_LOW: 'Bateria Baixa',
  OFFLINE: 'Offline',
  GEOFENCE_IN: 'Entrada em Cerca',
  GEOFENCE_OUT: 'Saída de Cerca',
};

export const ALERT_TYPE_COLORS: Record<AlertType, string> = {
  SPEED: '#ef4444',
  IGNITION_ON: '#10b981',
  IGNITION_OFF: '#eab308',
  SOS: '#ef4444',
  BATTERY_LOW: '#f97316',
  OFFLINE: '#6b7280',
  GEOFENCE_IN: '#3b82f6',
  GEOFENCE_OUT: '#8b5cf6',
};
