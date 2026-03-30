export type VehicleStatus = 'ACTIVE' | 'INACTIVE' | 'DEFAULTING' | 'BLOCKED';
export type DisplayStatus = 'moving' | 'stopped' | 'offline' | 'alert';

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
  lastUpdate: string;
  deviceStatus: string;
  displayStatus: DisplayStatus;
  ignition: boolean;
  satellites: number;
}
