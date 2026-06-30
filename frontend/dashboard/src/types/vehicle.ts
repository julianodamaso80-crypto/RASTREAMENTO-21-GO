export type VehicleStatus = 'ACTIVE' | 'INACTIVE' | 'DEFAULTING' | 'BLOCKED';
/** Tipo do veículo — define o desenho usado no mapa (carro x moto). */
export type VehicleType = 'CAR' | 'MOTORCYCLE';
/**
 * Sinal visual no mapa e na lista. 3 estados que o dono entende:
 *
 *  ignition_on  — rastreador OK (comunicando) + motor LIGADO   → VERDE   "Carro/Moto ligado"
 *  ignition_off — rastreador OK (comunicando) + motor DESLIGADO → LARANJA "Carro/Moto desligado"
 *  offline      — rastreador parou de comunicar (não marca mais
 *                 localização, defeito técnico)                 → VERMELHO "GPS com defeito" + central
 *  alert        — veículo BLOQUEADO (operação ativa)            → vermelho intenso
 *
 * Carro parado e desligado NÃO é defeito — o rastreador continua online,
 * só não manda GPS novo porque está estático. Só vira "GPS com defeito"
 * quando o rastreador some (heartbeat para = sem comunicação).
 */
export type DisplayStatus =
  | 'ignition_on'
  | 'ignition_off'
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
  vehicleType: VehicleType;
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
