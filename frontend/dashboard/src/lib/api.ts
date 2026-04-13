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
  getById: async (id: string): Promise<Vehicle> => {
    const res = await api.get<ApiResponse<Vehicle>>(`/vehicles/${id}`);
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

export default api;

