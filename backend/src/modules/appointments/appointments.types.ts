import type {
  AppointmentShift,
  AppointmentStatus,
  MaintenanceReason,
  ServiceConduction,
  ServiceType,
  TechnicianServiceStatus,
} from '.prisma/client';

export interface CriarAgendamento {
  serviceType: ServiceType;
  maintenanceReason?: MaintenanceReason | null;
  conduction?: ServiceConduction;
  /// Dia no formato YYYY-MM-DD. O par (turno, horas) resolve o resto.
  date: string;
  shift: AppointmentShift;
  startTime?: string | null;
  endTime?: string | null;
  technicianId: string;

  vehicleId?: string | null;
  plate?: string | null;
  chassi?: string | null;
  imei?: string | null;
  brand?: string | null;
  model?: string | null;
  installLocation?: string | null;

  clientName?: string | null;
  cpfCnpj?: string | null;
  phone?: string | null;
  email?: string | null;

  cep?: string | null;
  address?: string | null;
  complement?: string | null;
  lat?: number | null;
  lng?: number | null;

  value?: number | null;
  description?: string | null;
  technicianNote?: string | null;

  /// Pendência do SGA que originou a OS, quando veio da lista arrastável.
  installationPendingId?: string | null;
}

export type EditarAgendamento = Partial<CriarAgendamento>;

export interface MudarStatus {
  status: AppointmentStatus;
  note?: string | null;
  /// Coordenada de quem declarou o desfecho, quando o navegador entregou.
  lat?: number | null;
  lng?: number | null;
  technicianStatus?: TechnicianServiceStatus | null;
}

export interface FiltroAgenda {
  technicianIds?: string[];
  status?: AppointmentStatus[];
  serviceType?: ServiceType;
  from: Date;
  to: Date;
  search?: string;
}

/// O que o veículo devolve pra preencher o formulário sozinho.
export interface PreenchimentoVeiculo {
  origem: 'ATIVO' | 'PENDENCIA_SGA' | 'ESPELHO_SGA';
  vehicleId?: string;
  plate?: string;
  chassi?: string;
  imei?: string;
  brand?: string;
  model?: string;
  installLocation?: string;
  clientName?: string;
  cpfCnpj?: string;
  phone?: string;
  email?: string;
  cep?: string;
  address?: string;
  lat?: number;
  lng?: number;
  /// Situação no SGA quando a origem é cadastro do SGA. A tela avisa, não bloqueia.
  sgaSituation?: string;
  installationPendingId?: string;
}
