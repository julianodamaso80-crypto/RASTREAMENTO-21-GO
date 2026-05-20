export type VehicleStatus = 'ACTIVE' | 'INACTIVE' | 'DEFAULTING' | 'BLOCKED';
/**
 * Sinal visual no mapa e na lista. Critério é IGNIÇÃO, não movimento,
 * porque o operador precisa saber em 1s "o motor desse carro está rodando?"
 * — pista direta de risco/uso. Movimento é derivado (mostrado como speed).
 *
 *  ignition_on  — motor rodando agora (pode estar parado em semáforo) → verde
 *  ignition_off — motor desligado (estacionado normal)                 → vermelho
 *  gps_silent   — heartbeat ok mas posição GPS stale >3min             → laranja
 *  offline      — sem heartbeat >10min (rastreador morto/sem sinal)    → cinza
 *  alert        — veículo BLOQUEADO (operação ativa)                   → vermelho intenso
 */
export type DisplayStatus =
  | 'ignition_on'
  | 'ignition_off'
  | 'gps_silent'
  | 'offline'
  | 'alert';

export interface Associate {
  id: string;
  name: string;
  cpf: string;
  phone: string | null;
}

export interface Vehicle {
  id: string;
  plate: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  chassi: string | null;
  renavam: string | null;
  uniqueId: string;
  traccarDeviceId: number | null;
  status: VehicleStatus;
  tenantId: string;
  associateId: string | null;
  hinovaCode: string | null;
  lastSync: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  associate: Associate | null;
}

export interface VehicleWithTracking extends Vehicle {
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  address: string;
  // Heartbeat do device (Traccar lastUpdate). Pode ser keep-alive sem GPS novo.
  lastUpdate: string;
  // Timestamp da ÚLTIMA posição GPS real (Traccar position.deviceTime/serverTime).
  // Usar este quando a pergunta é "quando o GPS mexeu pela última vez?".
  // Quando null, nunca houve posição.
  positionTime: string | null;
  deviceStatus: string;
  displayStatus: DisplayStatus;
  ignition: boolean;
  satellites: number;
}
