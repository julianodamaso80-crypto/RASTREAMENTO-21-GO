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
