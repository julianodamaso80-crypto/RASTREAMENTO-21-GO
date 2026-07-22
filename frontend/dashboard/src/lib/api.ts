import axios from 'axios';
import type { LoginRequest, LoginResponse, User } from '@/types/auth';
import type { Vehicle } from '@/types/vehicle';
import type { TraccarDevice, TraccarPosition } from '@/types/traccar';
import type { Alert } from '@/types/alert';
import type { Trip, Stop } from '@/types/report';
import type { Geofence, CreateGeofencePayload } from '@/types/geofence';
import type { Device, Chip, SmsCommand, GeneratedCommandsResponse, OperatorApn, ServerInfo } from '@/types/device';
import type { DashboardOverview, DashboardPeriod } from '@/types/dashboard';
import type { PaginatedResponse, ApiResponse } from '@/types/api';
import type { BleTag, BleSighting } from '@/types/ble-tag';
import type {
  StockItem,
  StockStats,
  StockImportResult,
  HinovaLookup,
  StockAssociateResult,
  StockAssignResult,
  ActiveClient,
} from '@/types/stock';
import type {
  Technician,
  TechnicianAssignment,
  TechnicianWithPassword,
  CreateTechnicianPayload,
  UpdateTechnicianPayload,
} from '@/types/technician';
import type {
  InstallationPending,
  InstallationPendingStats,
  InstallationPendingSyncStart,
  InstallationPendingSyncStatus,
  InstallationPendingFilters,
} from '@/types/installation-pending';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL + '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// JWT interceptor
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// 401 redirect
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export const authApi = {
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const res = await api.post<ApiResponse<LoginResponse>>('/auth/login', data);
    return res.data.data;
  },
  me: async (): Promise<User> => {
    const res = await api.get<ApiResponse<User>>('/auth/me');
    return res.data.data;
  },
  forgotPassword: async (email: string): Promise<void> => {
    await api.post('/auth/forgot-password', { email });
  },
  resetPassword: async (token: string, password: string): Promise<void> => {
    await api.post('/auth/reset-password', { token, password });
  },
};

export const vehiclesApi = {
  getAll: async (params?: Record<string, string | number>): Promise<PaginatedResponse<Vehicle>> => {
    const res = await api.get<PaginatedResponse<Vehicle>>('/vehicles', { params });
    return res.data;
  },
  // Para role CLIENT: lista apenas veículos vinculados via UserVehicleAccess
  getMine: async (params?: Record<string, string | number>): Promise<PaginatedResponse<Vehicle>> => {
    const res = await api.get<PaginatedResponse<Vehicle>>('/vehicles/mine', { params });
    return res.data;
  },
  getById: async (id: string): Promise<Vehicle> => {
    const res = await api.get<ApiResponse<Vehicle>>(`/vehicles/${id}`);
    return res.data.data;
  },
  update: async (id: string, data: Partial<Vehicle>): Promise<Vehicle> => {
    const res = await api.patch<ApiResponse<Vehicle>>(`/vehicles/${id}`, data);
    return res.data.data;
  },
  block: async (id: string): Promise<Vehicle> => {
    const res = await api.post<ApiResponse<Vehicle>>(`/vehicles/${id}/block`);
    return res.data.data;
  },
  unblock: async (id: string): Promise<Vehicle> => {
    const res = await api.post<ApiResponse<Vehicle>>(`/vehicles/${id}/unblock`);
    return res.data.data;
  },
};

export type BehaviorPeriod = '24h' | '7d' | '30d';

export interface BehaviorReport {
  period: BehaviorPeriod;
  from: string;
  to: string;
  ignitionCycles: number;
  engineMinutes: number;
  idleMinutes: number;
  drivingMinutes: number;
  distanceKm: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  speedExcessCount: number;
  harshBrakeCount: number;
  harshAccelCount: number;
  nightDriveKm: number;
  hourlyHeatmap: number[][];
}

export interface TelemetryPoint {
  deviceTime: string;
  speed: number;
  rpm: number | null;
  fuel: number | null;
  temperature: number | null;
  powerVolts: number | null;
}

export interface ReplayPosition {
  deviceTime: string;
  latitude: number;
  longitude: number;
  speed: number;
  course: number | null;
  ignition: boolean | null;
}

export interface ReplayEvent {
  type: string;
  message: string;
  createdAt: string;
  latitude: number | null;
  longitude: number | null;
}

export interface VehicleScore {
  vehicleId: string;
  periodDays: number;
  totalScore: number;
  kmAnalyzed: number;
  breakdown: Record<string, number>;
}

export interface RankingRow {
  vehicleId: string;
  plate: string;
  brand: string | null;
  model: string | null;
  totalScore: number;
  kmAnalyzed: number;
  breakdown: {
    speed: number;
    harshBrake: number;
    harshAccel: number;
    idle: number;
    night: number;
    consistency: number;
  };
}

export const scoringApi = {
  ranking: async (limit = 100): Promise<RankingRow[]> => {
    const res = await api.get<ApiResponse<RankingRow[]>>('/scores/ranking', {
      params: { limit },
    });
    return res.data.data;
  },
};

export const analyticsApi = {
  getBehavior: async (vehicleId: string, period: BehaviorPeriod = '7d'): Promise<BehaviorReport> => {
    const res = await api.get<ApiResponse<BehaviorReport>>(`/vehicles/${vehicleId}/behavior`, {
      params: { period },
    });
    return res.data.data;
  },
  getTelemetry: async (vehicleId: string, period: BehaviorPeriod = '24h'): Promise<TelemetryPoint[]> => {
    const res = await api.get<ApiResponse<TelemetryPoint[]>>(`/vehicles/${vehicleId}/telemetry`, {
      params: { period },
    });
    return res.data.data;
  },
  getReplay: async (
    vehicleId: string,
    from: string,
    to: string,
  ): Promise<{ positions: ReplayPosition[]; events: ReplayEvent[] }> => {
    const res = await api.get<ApiResponse<{ positions: ReplayPosition[]; events: ReplayEvent[] }>>(
      `/vehicles/${vehicleId}/replay`,
      { params: { from, to } },
    );
    return res.data.data;
  },
  getScore: async (vehicleId: string): Promise<VehicleScore> => {
    const res = await api.get<ApiResponse<VehicleScore>>(`/vehicles/${vehicleId}/score`);
    return res.data.data;
  },
};

export interface TenantSettings {
  speedThresholdKmh: number;
  offlineThresholdMinutes: number;
  batteryDeviceLowThreshold: number;
  batteryVehicleLowVolts: number;
  harshBrakeKmhPerSec: number;
  harshAccelKmhPerSec: number;
  fuelDropPercentForTheft: number;
  fuelDropWindowMinutes: number;
  engineOverheatCelsius: number;
  idleSpeedKmh: number;
  autoBlockOnPowerCut: boolean;
  jammingConfirmReadings: number;
  notifyChannels: { email: boolean; push: boolean; whatsapp: boolean };
  notifyTypes: Record<string, boolean> | null;
}

export const settingsApi = {
  get: async (): Promise<TenantSettings> => {
    const res = await api.get<ApiResponse<TenantSettings>>('/settings');
    return res.data.data;
  },
  update: async (patch: Partial<TenantSettings>): Promise<TenantSettings> => {
    const res = await api.put<ApiResponse<TenantSettings>>('/settings', patch);
    return res.data.data;
  },
};

export interface MaintenancePlan {
  id: string;
  vehicleId: string;
  name: string;
  type: string;
  intervalKm: number | null;
  intervalEngineHours: number | null;
  intervalMonths: number | null;
  lastDoneAt: string | null;
  lastDoneKm: number | null;
  lastDoneEngineHours: number | null;
  active: boolean;
}

export const maintenanceApi = {
  list: async (vehicleId?: string): Promise<MaintenancePlan[]> => {
    const res = await api.get<ApiResponse<MaintenancePlan[]>>('/maintenance-plans', {
      params: vehicleId ? { vehicleId } : {},
    });
    return res.data.data;
  },
  create: async (payload: Partial<MaintenancePlan>): Promise<MaintenancePlan> => {
    const res = await api.post<ApiResponse<MaintenancePlan>>('/maintenance-plans', payload);
    return res.data.data;
  },
  update: async (id: string, payload: Partial<MaintenancePlan>): Promise<MaintenancePlan> => {
    const res = await api.patch<ApiResponse<MaintenancePlan>>(`/maintenance-plans/${id}`, payload);
    return res.data.data;
  },
  markDone: async (id: string): Promise<MaintenancePlan> => {
    const res = await api.post<ApiResponse<MaintenancePlan>>(`/maintenance-plans/${id}/done`);
    return res.data.data;
  },
};

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export const assistantApi = {
  ask: async (message: string, conversationId?: string): Promise<{ conversationId: string; reply: AssistantMessage }> => {
    const res = await api.post<ApiResponse<{ conversationId: string; reply: AssistantMessage }>>('/assistant/chat', {
      message,
      conversationId,
    });
    return res.data.data;
  },
  history: async (conversationId: string): Promise<AssistantMessage[]> => {
    const res = await api.get<ApiResponse<AssistantMessage[]>>(`/assistant/conversations/${conversationId}`);
    return res.data.data;
  },
};

export const traccarApi = {
  getDevices: async (): Promise<TraccarDevice[]> => {
    const res = await api.get<ApiResponse<TraccarDevice[]>>('/traccar/devices');
    return res.data.data;
  },
  getPositions: async (): Promise<TraccarPosition[]> => {
    const res = await api.get<ApiResponse<TraccarPosition[]>>('/traccar/positions');
    return res.data.data;
  },
  getHistory: async (deviceId: number, from: string, to: string): Promise<TraccarPosition[]> => {
    const res = await api.get<ApiResponse<TraccarPosition[]>>(
      `/traccar/positions/${deviceId}/history`,
      { params: { from, to } },
    );
    return res.data.data;
  },
};

export const alertsApi = {
  getAll: async (params?: Record<string, string | number | boolean>): Promise<PaginatedResponse<Alert>> => {
    const res = await api.get<PaginatedResponse<Alert>>('/alerts', { params });
    return res.data;
  },
  byVehicle: async (vehicleId: string, perPage = 50): Promise<PaginatedResponse<Alert>> => {
    const res = await api.get<PaginatedResponse<Alert>>('/alerts', {
      params: { vehicleId, perPage },
    });
    return res.data;
  },
  getUnreadCount: async (): Promise<number> => {
    const res = await api.get<ApiResponse<{ count: number }>>('/alerts/unread-count');
    return res.data.data.count;
  },
  markAsRead: async (id: string): Promise<void> => {
    await api.patch(`/alerts/${id}/read`);
  },
  markAllAsRead: async (): Promise<void> => {
    await api.post('/alerts/read-all');
  },
};

export const reportsApi = {
  getPositions: async (deviceId: number, from: string, to: string): Promise<TraccarPosition[]> => {
    const res = await api.get<ApiResponse<TraccarPosition[]>>('/reports/positions', {
      params: { deviceId, from, to },
    });
    return res.data.data;
  },
  getTrips: async (deviceId: number, from: string, to: string): Promise<Trip[]> => {
    const res = await api.get<ApiResponse<Trip[]>>('/reports/trips', {
      params: { deviceId, from, to },
    });
    return res.data.data;
  },
  getStops: async (deviceId: number, from: string, to: string): Promise<Stop[]> => {
    const res = await api.get<ApiResponse<Stop[]>>('/reports/stops', {
      params: { deviceId, from, to },
    });
    return res.data.data;
  },
  getExportUrl: (type: string, deviceId: number, from: string, to: string, format: string): string => {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    return `${base}/api/v1/reports/export?type=${type}&deviceId=${deviceId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=${format}`;
  },
};

export const geofencesApi = {
  getAll: async (params?: Record<string, string | number>): Promise<PaginatedResponse<Geofence>> => {
    const res = await api.get<PaginatedResponse<Geofence>>('/geofences', { params });
    return res.data;
  },
  getById: async (id: string): Promise<Geofence> => {
    const res = await api.get<ApiResponse<Geofence>>(`/geofences/${id}`);
    return res.data.data;
  },
  create: async (data: CreateGeofencePayload): Promise<Geofence> => {
    const res = await api.post<ApiResponse<Geofence>>('/geofences', data);
    return res.data.data;
  },
  update: async (id: string, data: Partial<CreateGeofencePayload>): Promise<Geofence> => {
    const res = await api.patch<ApiResponse<Geofence>>(`/geofences/${id}`, data);
    return res.data.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/geofences/${id}`);
  },
  linkVehicles: async (id: string, vehicleIds: string[]): Promise<Geofence> => {
    const res = await api.post<ApiResponse<Geofence>>(`/geofences/${id}/vehicles`, { vehicleIds });
    return res.data.data;
  },
};

export const devicesApi = {
  getAll: async (params?: Record<string, string | number>): Promise<PaginatedResponse<Device>> => {
    const res = await api.get<PaginatedResponse<Device>>('/devices', { params });
    return res.data;
  },
  getById: async (id: string): Promise<Device> => {
    const res = await api.get<ApiResponse<Device>>(`/devices/${id}`);
    return res.data.data;
  },
  create: async (data: Partial<Device>): Promise<Device> => {
    const res = await api.post<ApiResponse<Device>>('/devices', data);
    return res.data.data;
  },
  update: async (id: string, data: Partial<Device>): Promise<Device> => {
    const res = await api.patch<ApiResponse<Device>>(`/devices/${id}`, data);
    return res.data.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/devices/${id}`);
  },
  linkVehicle: async (id: string, vehicleId: string): Promise<Device> => {
    const res = await api.post<ApiResponse<Device>>(`/devices/${id}/link-vehicle/${vehicleId}`);
    return res.data.data;
  },
  unlinkVehicle: async (id: string): Promise<Device> => {
    const res = await api.post<ApiResponse<Device>>(`/devices/${id}/unlink-vehicle`);
    return res.data.data;
  },
  linkChip: async (id: string, chipId: string): Promise<Device> => {
    const res = await api.post<ApiResponse<Device>>(`/devices/${id}/link-chip/${chipId}`);
    return res.data.data;
  },
  unlinkChip: async (id: string): Promise<Device> => {
    const res = await api.post<ApiResponse<Device>>(`/devices/${id}/unlink-chip`);
    return res.data.data;
  },
  getConnectionStatus: async (id: string): Promise<any> => {
    const res = await api.get<ApiResponse<any>>(`/devices/${id}/connection-status`);
    return res.data.data;
  },
  generateCommands: async (id: string): Promise<GeneratedCommandsResponse> => {
    const res = await api.post<ApiResponse<GeneratedCommandsResponse>>(`/devices/${id}/commands/generate`);
    return res.data.data;
  },
  sendCommand: async (id: string, type: string, customCommand?: string): Promise<SmsCommand> => {
    const res = await api.post<ApiResponse<SmsCommand>>(`/devices/${id}/commands/send`, { type, customCommand });
    return res.data.data;
  },
  getCommands: async (id: string, params?: Record<string, string | number>): Promise<PaginatedResponse<SmsCommand>> => {
    const res = await api.get<PaginatedResponse<SmsCommand>>(`/devices/${id}/commands`, { params });
    return res.data;
  },
};

export const chipsApi = {
  getAll: async (params?: Record<string, string | number>): Promise<PaginatedResponse<Chip>> => {
    const res = await api.get<PaginatedResponse<Chip>>('/chips', { params });
    return res.data;
  },
  getById: async (id: string): Promise<Chip> => {
    const res = await api.get<ApiResponse<Chip>>(`/chips/${id}`);
    return res.data.data;
  },
  create: async (data: Partial<Chip>): Promise<Chip> => {
    const res = await api.post<ApiResponse<Chip>>('/chips', data);
    return res.data.data;
  },
  update: async (id: string, data: Partial<Chip>): Promise<Chip> => {
    const res = await api.patch<ApiResponse<Chip>>(`/chips/${id}`, data);
    return res.data.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/chips/${id}`);
  },
  getOperators: async (): Promise<OperatorApn[]> => {
    const res = await api.get<ApiResponse<OperatorApn[]>>('/chips/operators');
    return res.data.data;
  },
  getProviders: async (): Promise<string[]> => {
    const res = await api.get<ApiResponse<string[]>>('/chips/providers');
    return res.data.data;
  },
};

export const dashboardApi = {
  getOverview: async (period: DashboardPeriod): Promise<DashboardOverview> => {
    const res = await api.get<ApiResponse<DashboardOverview>>('/dashboard/overview', {
      params: { period },
    });
    return res.data.data;
  },
};

export const serverApi = {
  getInfo: async (): Promise<ServerInfo> => {
    const res = await api.get<ApiResponse<ServerInfo>>('/server/info');
    return res.data.data;
  },
};

export const bleTagsApi = {
  getAll: async (): Promise<BleTag[]> => {
    const res = await api.get<ApiResponse<BleTag[]>>('/ble-tags');
    return res.data.data;
  },
  getById: async (id: string): Promise<BleTag> => {
    const res = await api.get<ApiResponse<BleTag>>(`/ble-tags/${id}`);
    return res.data.data;
  },
  getSightings: async (id: string, params?: { page?: number; perPage?: number }): Promise<PaginatedResponse<BleSighting>> => {
    const res = await api.get<PaginatedResponse<BleSighting>>(`/ble-tags/${id}/sightings`, { params });
    return res.data;
  },
};

export const stockApi = {
  getAll: async (params?: Record<string, string | number>): Promise<PaginatedResponse<StockItem>> => {
    const res = await api.get<PaginatedResponse<StockItem>>('/stock', { params });
    return res.data;
  },
  getStats: async (): Promise<StockStats> => {
    const res = await api.get<ApiResponse<StockStats>>('/stock/stats');
    return res.data.data;
  },
  import: async (file: File): Promise<StockImportResult> => {
    const form = new FormData();
    form.append('file', file);
    const res = await api.post<ApiResponse<StockImportResult>>('/stock/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/stock/${id}`);
  },
  associate: async (
    id: string,
    payload: { placa: string; technicianName: string; installLocation: string },
  ): Promise<StockAssociateResult> => {
    const res = await api.post<ApiResponse<StockAssociateResult>>(
      `/stock/${id}/associate`,
      payload,
    );
    return res.data.data;
  },
  // Reserva em lote pro login do técnico. Marcar 1 checkbox é um lote de 1.
  assign: async (stockItemIds: string[], technicianId: string): Promise<StockAssignResult> => {
    const res = await api.post<ApiResponse<StockAssignResult>>('/stock/assign', {
      stockItemIds,
      technicianId,
    });
    return res.data.data;
  },
  unassign: async (stockItemIds: string[]): Promise<StockAssignResult> => {
    const res = await api.post<ApiResponse<StockAssignResult>>('/stock/unassign', {
      stockItemIds,
    });
    return res.data.data;
  },
};

export const techniciansApi = {
  getAll: async (search?: string): Promise<Technician[]> => {
    const res = await api.get<ApiResponse<Technician[]>>('/technicians', {
      params: search ? { search } : undefined,
    });
    return res.data.data;
  },
  create: async (payload: CreateTechnicianPayload): Promise<TechnicianWithPassword> => {
    const res = await api.post<ApiResponse<TechnicianWithPassword>>('/technicians', payload);
    return res.data.data;
  },
  update: async (id: string, payload: UpdateTechnicianPayload): Promise<Technician> => {
    const res = await api.patch<ApiResponse<Technician>>(`/technicians/${id}`, payload);
    return res.data.data;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/technicians/${id}`);
  },
  resetPassword: async (id: string): Promise<TechnicianWithPassword> => {
    const res = await api.post<ApiResponse<TechnicianWithPassword>>(
      `/technicians/${id}/reset-password`,
      {},
    );
    return res.data.data;
  },
  assignments: async (id: string): Promise<TechnicianAssignment[]> => {
    const res = await api.get<ApiResponse<TechnicianAssignment[]>>(
      `/technicians/${id}/assignments`,
    );
    return res.data.data;
  },
};

export const hinovaApi = {
  lookup: async (placa: string): Promise<HinovaLookup> => {
    const res = await api.get<ApiResponse<HinovaLookup>>(
      `/hinova/lookup/${encodeURIComponent(placa)}`,
    );
    return res.data.data;
  },
};

export const clientsApi = {
  getActive: async (search?: string): Promise<ActiveClient[]> => {
    const res = await api.get<ApiResponse<ActiveClient[]>>('/clients', {
      params: search ? { search } : undefined,
    });
    return res.data.data;
  },
};

function pendingParams(f: InstallationPendingFilters) {
  return {
    days: f.days,
    ...(f.type ? { type: f.type } : {}),
    ...(f.city ? { city: f.city } : {}),
    ...(f.search ? { search: f.search } : {}),
  };
}

export const installationPendingsApi = {
  getAll: async (f: InstallationPendingFilters): Promise<InstallationPending[]> => {
    const res = await api.get<ApiResponse<InstallationPending[]>>(
      '/installation-pendings',
      { params: pendingParams(f) },
    );
    return res.data.data;
  },
  getStats: async (days: number): Promise<InstallationPendingStats> => {
    const res = await api.get<ApiResponse<InstallationPendingStats>>(
      '/installation-pendings/stats',
      { params: { days } },
    );
    return res.data.data;
  },
  getCities: async (): Promise<string[]> => {
    const res = await api.get<ApiResponse<string[]>>(
      '/installation-pendings/cities',
    );
    return res.data.data;
  },
  /**
   * Dispara a varredura e volta na hora — ela roda em background no servidor.
   * Manter a requisição aberta não funcionaria: o Cloudflare corta em ~100s e a
   * varredura leva minutos. O acompanhamento é por getSyncStatus().
   */
  startSync: async (): Promise<InstallationPendingSyncStart> => {
    const res = await api.post<ApiResponse<InstallationPendingSyncStart>>(
      '/installation-pendings/sync',
      {},
    );
    return res.data.data;
  },
  getSyncStatus: async (): Promise<InstallationPendingSyncStatus> => {
    const res = await api.get<ApiResponse<InstallationPendingSyncStatus>>(
      '/installation-pendings/sync/status',
    );
    return res.data.data;
  },
  exportXlsx: async (f: InstallationPendingFilters): Promise<Blob> => {
    const res = await api.get('/installation-pendings/export', {
      params: pendingParams(f),
      responseType: 'blob',
    });
    return res.data as Blob;
  },
};

export default api;

