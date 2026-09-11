export type ServiceType = 'INSTALLATION' | 'MAINTENANCE' | 'REMOVAL' | 'OTHER';

export type MaintenanceReason =
  | 'WITH_REPLACEMENT'
  | 'WITHOUT_REPLACEMENT'
  | 'INSTALL_FAILURE'
  | 'SIGNAL_FAILURE'
  | 'WORKSHOP'
  | 'AFTER_THEFT'
  | 'LINE_OFF'
  | 'GPS_FAILURE';

export type ServiceConduction = 'FIXED_POINT' | 'MOBILE';

export type AppointmentShift =
  | 'MORNING'
  | 'AFTERNOON'
  | 'NIGHT'
  | 'ALL_DAY'
  | 'CUSTOM';

export type AppointmentStatus =
  | 'SCHEDULED'
  | 'CANCELED'
  | 'COMPLETED'
  | 'POSTPONED'
  | 'ANTICIPATED'
  | 'FRUSTRATED_CLIENT'
  | 'FRUSTRATED_TECHNICIAN'
  | 'CLOSED_BY_SYSTEM'
  | 'EXECUTED'
  | 'CLIENT_NO_SHOW'
  | 'CANCELED_BY_CLIENT';

export type TechnicianServiceStatus =
  | 'SCHEDULED'
  | 'CANCELED'
  | 'COMPLETED'
  | 'FRUSTRATED';

export type ExecutionTiming =
  | 'ON_TIME'
  | 'TECHNICIAN_LATE'
  | 'ANTICIPATED_BY_TECHNICIAN'
  | 'TECHNICIAN_EARLY';

/** O que o calendário desenha. */
export interface AppointmentEvent {
  id: string;
  osNumber: string;
  serviceType: ServiceType;
  status: AppointmentStatus;
  technicianStatus: TechnicianServiceStatus | null;
  executionTiming: ExecutionTiming;
  start: string;
  end: string;
  plate: string | null;
  clientName: string | null;
  address: string | null;
  autoScheduled: boolean;
  hasTechnicianReply: boolean;
  locationDenied: boolean;
  technicianId: string;
  technicianName: string;
  statusDiverge: boolean;
}

/** Ficha completa, aberta ao clicar no bloco. */
export interface Appointment {
  id: string;
  osNumber: string;
  serviceType: ServiceType;
  maintenanceReason: MaintenanceReason | null;
  conduction: ServiceConduction;
  scheduledStart: string;
  scheduledEnd: string;
  shift: AppointmentShift;
  technicianId: string;
  technician: { id: string; name: string; cpf: string };
  status: AppointmentStatus;
  technicianStatus: TechnicianServiceStatus | null;
  executionTiming: ExecutionTiming;
  statusNote: string | null;
  completedAt: string | null;
  completedLat: number | null;
  completedLng: number | null;
  locationDenied: boolean;
  vehicleId: string | null;
  plate: string | null;
  chassi: string | null;
  imei: string | null;
  brand: string | null;
  model: string | null;
  installLocation: string | null;
  clientName: string | null;
  cpfCnpj: string | null;
  phone: string | null;
  email: string | null;
  cep: string | null;
  address: string | null;
  complement: string | null;
  value: number;
  description: string | null;
  technicianNote: string | null;
  technicianReply: string | null;
  autoScheduled: boolean;
  installationPendingId: string | null;
}

/** Item da fila arrastável, vindo do espelho do SGA. */
export interface AgendaPendencia {
  id: string;
  plate: string;
  chassi: string | null;
  clientName: string;
  cpfCnpj: string | null;
  phone: string | null;
  email: string | null;
  brandModel: string;
  city: string | null;
  neighborhood: string | null;
  cep: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  contractDate: string;
  serviceType: 'INSTALLATION';
}

/** Resposta do preenchimento por placa/chassi. */
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
  sgaSituation?: string;
  installationPendingId?: string;
}

export interface CriarAgendamentoPayload {
  serviceType: ServiceType;
  maintenanceReason?: MaintenanceReason | null;
  conduction?: ServiceConduction;
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
  installationPendingId?: string | null;
}

export interface AgendaFiltro {
  from: string;
  to: string;
  technicianIds?: string[];
  status?: AppointmentStatus[];
  serviceType?: ServiceType;
  search?: string;
}

// --- Rótulos em PT-BR. Enum em inglês no código, texto traduzido na tela. ---

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  INSTALLATION: 'Instalação',
  MAINTENANCE: 'Manutenção',
  REMOVAL: 'Retirada',
  OTHER: 'Outros',
};

export const MAINTENANCE_REASON_LABEL: Record<MaintenanceReason, string> = {
  WITH_REPLACEMENT: 'Manutenção com troca',
  WITHOUT_REPLACEMENT: 'Manutenção sem troca',
  INSTALL_FAILURE: 'Manutenção falha na instalação',
  SIGNAL_FAILURE: 'Manutenção falha de sinal',
  WORKSHOP: 'Manutenção oficina',
  AFTER_THEFT: 'Manutenção pós roubo',
  LINE_OFF: 'Manutenção linha off',
  GPS_FAILURE: 'Manutenção falha no GPS',
};

export const CONDUCTION_LABEL: Record<ServiceConduction, string> = {
  FIXED_POINT: 'Ponto fixo',
  MOBILE: 'Volante',
};

export const SHIFT_LABEL: Record<AppointmentShift, string> = {
  MORNING: 'Manhã',
  AFTERNOON: 'Tarde',
  NIGHT: 'Noite',
  ALL_DAY: 'Dia todo',
  CUSTOM: 'Customizável',
};

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Agendado',
  CANCELED: 'Cancelado',
  COMPLETED: 'Concluído',
  POSTPONED: 'Prorrogado',
  ANTICIPATED: 'Adiantado',
  FRUSTRATED_CLIENT: 'Visita frustrada cliente',
  FRUSTRATED_TECHNICIAN: 'Visita frustrada técnico',
  CLOSED_BY_SYSTEM: 'Concluído pelo sistema',
  EXECUTED: 'Auto-agendamento executado',
  CLIENT_NO_SHOW: 'Auto-agendamento cliente não compareceu',
  CANCELED_BY_CLIENT: 'Auto-agendamento cancelado pelo cliente',
};

/** Ordem dos status nos filtros, a mesma da origem (1..13). */
export const STATUS_ORDEM: AppointmentStatus[] = [
  'SCHEDULED',
  'CANCELED',
  'COMPLETED',
  'POSTPONED',
  'ANTICIPATED',
  'FRUSTRATED_CLIENT',
  'FRUSTRATED_TECHNICIAN',
  'CLOSED_BY_SYSTEM',
  'EXECUTED',
  'CLIENT_NO_SHOW',
  'CANCELED_BY_CLIENT',
];

/** Status em que a OS pode ser duplicada ou excluída (agendado, prorrogado, adiantado). */
export const STATUS_EM_ABERTO: AppointmentStatus[] = [
  'SCHEDULED',
  'POSTPONED',
  'ANTICIPATED',
];

/** Filtrando pela data de conclusão, só sobram estes (a origem desabilita o resto). */
export const STATUS_COM_CONCLUSAO: AppointmentStatus[] = [
  'COMPLETED',
  'CLOSED_BY_SYSTEM',
  'EXECUTED',
  'CLIENT_NO_SHOW',
  'CANCELED_BY_CLIENT',
];

/** Um card da aba "Ordens de Serviço". */
export interface OrdemServico {
  id: string;
  osNumber: string;
  serviceType: ServiceType;
  maintenanceReason: MaintenanceReason | null;
  conduction: ServiceConduction;
  status: AppointmentStatus;
  technicianStatus: TechnicianServiceStatus | null;
  scheduledStart: string;
  scheduledEnd: string;
  shift: AppointmentShift;
  completedAt: string | null;
  plate: string | null;
  chassi: string | null;
  imei: string | null;
  brand: string | null;
  model: string | null;
  clientName: string | null;
  cpfCnpj: string | null;
  phone: string | null;
  cep: string | null;
  address: string | null;
  complement: string | null;
  lat: number | null;
  lng: number | null;
  value: string | number;
  description: string | null;
  technicianNote: string | null;
  statusNote: string | null;
  autoScheduled: boolean;
  createdAt: string;
  technician: { id: string; name: string };
  createdBy: { id: string; name: string } | null;
}

export interface FiltroOrdens {
  from: string;
  to: string;
  tipoData: 'AGENDAMENTO' | 'CONCLUSAO';
  technicianIds?: string[];
  createdByIds?: string[];
  status?: AppointmentStatus[];
  serviceType?: ServiceType | '';
  search?: string;
}

export type GraficoAnalise =
  | 'usuarios'
  | 'tecnicos'
  | 'motivos-manutencao'
  | 'status'
  | 'servicos'
  | 'visitas-frustradas';

export interface ItemGrafico {
  chave: string;
  nome: string;
  qtd: number;
}

export interface ResumoAnalise {
  hoje: number;
  semana: number;
  mes: number;
}

export const TECHNICIAN_STATUS_LABEL: Record<TechnicianServiceStatus, string> = {
  SCHEDULED: 'Agendado',
  CANCELED: 'Cancelado',
  COMPLETED: 'Concluído',
  FRUSTRATED: 'Visita frustrada',
};

/** Janela de cada turno, para a tela mostrar sem consultar o servidor. */
export const SHIFT_HOURS: Record<
  Exclude<AppointmentShift, 'CUSTOM'>,
  [string, string]
> = {
  MORNING: ['08:00', '12:00'],
  AFTERNOON: ['13:00', '18:00'],
  NIGHT: ['18:00', '22:00'],
  ALL_DAY: ['08:00', '18:00'],
};

/** Desfechos que a origem recusa em branco — e nós também. */
export const STATUS_EXIGE_OBSERVACAO: AppointmentStatus[] = [
  'CANCELED',
  'CANCELED_BY_CLIENT',
  'FRUSTRATED_CLIENT',
  'FRUSTRATED_TECHNICIAN',
];
