export interface BleSighting {
  id: string;
  deviceId: string;
  macAddress: string;
  rssi: number | null;
  accuracy: number | null;
  seenAt: string;
  hashedAdvKey: string | null;
  counterByte: number | null;
  scannerLat: number | null;
  scannerLng: number | null;
  scannerSource: string | null;
  tenantId: string;
  createdAt: string;
}

export interface BleTag {
  id: string;
  imei: string;
  model: 'BLE_KTAG' | 'BLE_REDTAG' | 'BLE_AIRTAG_GENERIC';
  brand: string | null;
  notes: string | null;
  status: string;
  vehicleId: string | null;
  tenantId: string;
  installedAt: string | null;
  lastConnection: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  vehicle: {
    id: string;
    plate: string;
    brand: string | null;
    model: string | null;
  } | null;
  bleSightings: Array<Pick<BleSighting, 'id' | 'macAddress' | 'rssi' | 'accuracy' | 'seenAt' | 'scannerLat' | 'scannerLng' | 'scannerSource' | 'createdAt'>>;
}

export interface BleSightingEvent {
  deviceId: string;
  deviceImei: string;
  deviceModel: string;
  vehicleId: string | null;
  sighting: {
    id: string;
    macAddress: string;
    rssi: number | null;
    accuracy: number | null;
    seenAt: string;
    scannerLat: number | null;
    scannerLng: number | null;
    scannerSource: string | null;
    createdAt: string;
  };
}

/**
 * TAG em uso: vinculada a um veículo e ainda instalada. Traz o cliente junto
 * porque a tela existe pro atendimento, que precisa saber de quem é a TAG.
 */
export interface ActiveBleTag extends Omit<BleTag, 'vehicle'> {
  installLocation: string | null;
  installedBy: string | null;
  uninstalledAt: string | null;
  installedByTechnician: { id: string; name: string } | null;
  vehicle: {
    id: string;
    plate: string;
    brand: string | null;
    model: string | null;
    vehicleType: 'CAR' | 'MOTORCYCLE';
    associate: { id: string; name: string; cpf: string | null } | null;
  } | null;
}
