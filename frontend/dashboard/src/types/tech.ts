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

export interface TechSignal {
  online: boolean;
  lastUpdate: string | null;
  motivo: string | null;
}

export interface TechRouteStop {
  id: string;
  order: number;
  status: 'PENDING' | 'DONE';
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
