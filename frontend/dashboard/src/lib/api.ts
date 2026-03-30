import axios from 'axios';
import type { LoginRequest, LoginResponse, User } from '@/types/auth';
import type { Vehicle } from '@/types/vehicle';
import type { TraccarDevice, TraccarPosition } from '@/types/traccar';
import type { Alert } from '@/types/alert';
import type { Trip, Stop } from '@/types/report';
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

export default api;
