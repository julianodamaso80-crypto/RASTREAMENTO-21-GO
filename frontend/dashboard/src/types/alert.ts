export type AlertType =
  | 'SPEED'
  | 'IGNITION_ON'
  | 'IGNITION_OFF'
  | 'SOS'
  | 'BATTERY_LOW'
  | 'OFFLINE'
  | 'GEOFENCE_IN'
  | 'GEOFENCE_OUT'
  | 'POWER_CUT'
  | 'JAMMING'
  | 'VEHICLE_BATTERY_LOW'
  | 'HARSH_BRAKE'
  | 'HARSH_ACCEL'
  | 'FUEL_THEFT'
  | 'MAINTENANCE_DUE'
  | 'ENGINE_OVERHEATING'
  | 'COLLISION';

export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface Alert {
  id: string;
  type: AlertType;
  severity?: AlertSeverity;
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
  BATTERY_LOW: 'Bateria do rastreador baixa',
  OFFLINE: 'Offline',
  GEOFENCE_IN: 'Entrada em Cerca',
  GEOFENCE_OUT: 'Saída de Cerca',
  POWER_CUT: 'Corte de energia (sabotagem)',
  JAMMING: 'Bloqueador de sinal',
  VEHICLE_BATTERY_LOW: 'Bateria do veículo fraca',
  HARSH_BRAKE: 'Frenagem brusca',
  HARSH_ACCEL: 'Aceleração brusca',
  FUEL_THEFT: 'Roubo de combustível',
  MAINTENANCE_DUE: 'Manutenção pendente',
  ENGINE_OVERHEATING: 'Motor superaquecendo',
  COLLISION: 'Colisão detectada',
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
  POWER_CUT: '#dc2626',
  JAMMING: '#dc2626',
  VEHICLE_BATTERY_LOW: '#f97316',
  HARSH_BRAKE: '#f59e0b',
  HARSH_ACCEL: '#f59e0b',
  FUEL_THEFT: '#dc2626',
  MAINTENANCE_DUE: '#eab308',
  ENGINE_OVERHEATING: '#dc2626',
  COLLISION: '#dc2626',
};
