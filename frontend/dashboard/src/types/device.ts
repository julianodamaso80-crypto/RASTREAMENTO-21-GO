export type DeviceModel =
  | 'GT06N' | 'GT06' | 'ST310U' | 'ST340' | 'ST350'
  | 'J16' | 'J16_PRO' | 'CRX3' | 'CRX3_NANO' | 'CRX_PRO_4G'
  | 'TK103' | 'TK303' | 'FMB920' | 'FMB120'
  | 'COBAN_GPS103' | 'CONCOX_GT06N' | 'SINOTRACK_ST901' | 'SINOTRACK_ST905'
  | 'OTHER';

export type DeviceStatus =
  | 'PENDING_INSTALL' | 'INSTALLED' | 'CONFIGURING'
  | 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'DEACTIVATED';

export type ChipOperator = 'VIVO' | 'CLARO' | 'TIM' | 'OI' | 'MULTI_OPERATOR';
export type ChipStatus = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'BLOCKED' | 'CANCELLED';
export type ApnType = 'PUBLIC' | 'PRIVATE';

export type CommandType =
  | 'SET_SERVER_IP' | 'SET_APN' | 'SET_TIMER' | 'SET_TIMEZONE'
  | 'BLOCK' | 'UNBLOCK' | 'RESTART' | 'GET_LOCATION'
  | 'GET_PARAMS' | 'GET_IMEI' | 'FACTORY_RESET' | 'CUSTOM';

export type CommandStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'RESPONDED' | 'FAILED';

export interface Chip {
  id: string;
  iccid: string;
  phoneNumber?: string;
  operator: ChipOperator;
  apn: string;
  apnUser?: string;
  apnPassword?: string;
  apnType: ApnType;
  dataPlanMb: number;
  provider?: string;
  status: ChipStatus;
  activatedAt?: string;
  expiresAt?: string;
  device?: { id: string; imei: string; model: DeviceModel; status: DeviceStatus };
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  imei: string;
  model: DeviceModel;
  brand?: string;
  firmwareVersion?: string;
  serialNumber?: string;
  traccarDeviceId?: number;
  status: DeviceStatus;
  chipId?: string;
  chip?: Chip;
  vehicleId?: string;
  vehicle?: { id: string; plate: string; brand?: string; model?: string };
  tenantId: string;
  installedAt?: string;
  installedBy?: string;
  lastConnection?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  smsCommands?: SmsCommand[];
}

export interface SmsCommand {
  id: string;
  deviceId: string;
  command: string;
  type: CommandType;
  status: CommandStatus;
  sentAt?: string;
  response?: string;
  respondedAt?: string;
  sentBy: string;
  tenantId: string;
  createdAt: string;
}

export interface GeneratedCommand {
  step: number;
  type: string;
  label: string;
  command: string;
  phoneNumber: string;
  protocol: string;
  port: number;
}

export interface GeneratedCommandsResponse {
  device: { id: string; imei: string; model: string };
  chip: { id: string; phoneNumber: string; operator: string; apn: string } | null;
  serverIp: string;
  secondaryIp: string;
  maintenanceIp: string;
  serverPort: number;
  protocol: string;
  supportsMultiIp: boolean;
  commands: GeneratedCommand[];
}

export interface OperatorApn {
  operator: ChipOperator;
  apns: { apn: string; user: string; pass: string }[];
}

export interface ServerInfo {
  ip: string;
  primaryIp: string;
  secondaryIp: string;
  maintenanceIp: string;
  traccar: { version: string; status: string };
  ports: { port: number; protocol: string; models: string[]; status: string }[];
}

export const DEVICE_MODEL_LABELS: Record<DeviceModel, string> = {
  GT06N: 'GT06N', GT06: 'GT06', ST310U: 'ST310U', ST340: 'ST340', ST350: 'ST350',
  J16: 'J16', J16_PRO: 'J16 Pro', CRX3: 'CRX3', CRX3_NANO: 'CRX3 Nano',
  CRX_PRO_4G: 'CRX Pro 4G', TK103: 'TK103', TK303: 'TK303',
  FMB920: 'FMB920', FMB120: 'FMB120', COBAN_GPS103: 'Coban GPS103',
  CONCOX_GT06N: 'Concox GT06N', SINOTRACK_ST901: 'Sinotrack ST901',
  SINOTRACK_ST905: 'Sinotrack ST905', OTHER: 'Outro',
};

export const DEVICE_STATUS_LABELS: Record<DeviceStatus, string> = {
  PENDING_INSTALL: 'Aguardando Instalação',
  INSTALLED: 'Instalado',
  CONFIGURING: 'Configurando',
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  MAINTENANCE: 'Manutenção',
  DEACTIVATED: 'Desativado',
};

export const DEVICE_STATUS_COLORS: Record<DeviceStatus, string> = {
  PENDING_INSTALL: 'bg-slate-500/20 text-slate-400',
  INSTALLED: 'bg-blue-500/20 text-blue-400',
  CONFIGURING: 'bg-yellow-500/20 text-yellow-400',
  ONLINE: 'bg-emerald-500/20 text-emerald-400',
  OFFLINE: 'bg-red-500/20 text-red-400',
  MAINTENANCE: 'bg-orange-500/20 text-orange-400',
  DEACTIVATED: 'bg-gray-500/20 text-gray-400',
};

export const CHIP_STATUS_LABELS: Record<ChipStatus, string> = {
  ACTIVE: 'Ativo', SUSPENDED: 'Suspenso', EXPIRED: 'Expirado',
  BLOCKED: 'Bloqueado', CANCELLED: 'Cancelado',
};

export const CHIP_STATUS_COLORS: Record<ChipStatus, string> = {
  ACTIVE: 'bg-emerald-500/20 text-emerald-400',
  SUSPENDED: 'bg-yellow-500/20 text-yellow-400',
  EXPIRED: 'bg-orange-500/20 text-orange-400',
  BLOCKED: 'bg-red-500/20 text-red-400',
  CANCELLED: 'bg-gray-500/20 text-gray-400',
};

export const OPERATOR_LABELS: Record<ChipOperator, string> = {
  VIVO: 'Vivo', CLARO: 'Claro', TIM: 'TIM', OI: 'Oi', MULTI_OPERATOR: 'Multi-Operadora',
};
