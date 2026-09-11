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

/// Filtros da aba "Ordens de Serviço", os mesmos da origem.
export interface FiltroLista {
  from: Date;
  to: Date;
  /// Qual data o período filtra: a do agendamento ou a da conclusão.
  tipoData: 'AGENDAMENTO' | 'CONCLUSAO';
  technicianIds?: string[];
  /// Usuário que criou o agendamento ("Selecione um usuário").
  createdByIds?: string[];
  status?: AppointmentStatus[];
  serviceType?: ServiceType;
  search?: string;
}

/// Os gráficos da aba "Análise". Cada um tem o próprio período.
export type GraficoAnalise =
  | 'usuarios'
  | 'tecnicos'
  | 'motivos-manutencao'
  | 'status'
  | 'servicos'
  | 'visitas-frustradas';

export interface FiltroGrafico {
  from: Date;
  to: Date;
  status?: AppointmentStatus;
  maintenanceReason?: MaintenanceReason;
}

/// Uma barra/fatia de gráfico: rótulo e quantidade.
export interface ItemGrafico {
  chave: string;
  nome: string;
  qtd: number;
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
