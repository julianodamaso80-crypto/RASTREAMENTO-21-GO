export interface Technician {
  id: string;
  name: string;
  cpf: string;
  phone: string | null;
  email: string | null;
  canReceiveEquipment: boolean;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** Equipamentos reservados pra ele e ainda não instalados. */
  assignedCount: number;
  /** Instalações finalizadas por ele. */
  installCount: number;
}

export interface TechnicianAssignment {
  id: string;
  imei: string;
  iccid: string | null;
  line: string | null;
  operator: string | null;
  server: string | null;
  assignedAt: string | null;
}

export interface CreateTechnicianPayload {
  name: string;
  cpf: string;
  phone?: string;
  email?: string;
  canReceiveEquipment?: boolean;
}

export interface UpdateTechnicianPayload {
  name?: string;
  phone?: string;
  email?: string;
  canReceiveEquipment?: boolean;
  active?: boolean;
}

/** Retorno de criar técnico / resetar senha — a senha aparece uma única vez. */
export interface TechnicianWithPassword {
  technician: {
    id: string;
    name: string;
    cpf: string;
    phone?: string | null;
    email?: string | null;
  };
  tempPassword: string;
}
