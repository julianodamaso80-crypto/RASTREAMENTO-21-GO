export interface TechMe {
  id: string;
  name: string;
  cpf: string;
  phone: string | null;
  mustChangePassword: boolean;
  tenant: {
    id: string;
    name: string;
    logoUrl: string | null;
    primaryColor: string | null;
  };
}

export interface TechLoginResponse {
  accessToken: string;
  technician: {
    id: string;
    name: string;
    cpf: string;
    tenantId: string;
    mustChangePassword: boolean;
  };
}

export interface TechAssignment {
  id: string;
  imei: string;
  iccid: string | null;
  line: string | null;
  operator: string | null;
  server: string | null;
  status: string | null;
  assignedAt: string | null;
}

/**
 * Conferência de instalação. `online` é só o chip conversando (heartbeat);
 * quem prova que a instalação está boa é `checkOk` — GPS válido, recente e,
 * quando o celular do técnico dá a posição, a menos de 500m dele.
 */
export interface TechSignal {
  online: boolean;
  lastUpdate: string | null;
  gpsOk: boolean;
  position: { latitude: number; longitude: number; fixTime: string } | null;
  satellites: number | null;
  distanceM: number | null;
  checkOk: boolean;
  motivo: string | null;
}

export interface TechRouteStop {
  id: string;
  order: number;
  status: 'PENDING' | 'DONE' | 'CANCELLED';
  note?: string | null;
  plate: string;
  pendingType: 'TRACKER' | 'TAG';
  associateName: string;
  phone: string | null;
  brandModel: string;
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
}

export interface TechRoute {
  id: string;
  status: 'PENDING' | 'DONE' | 'CANCELLED';
  stops: TechRouteStop[];
}
