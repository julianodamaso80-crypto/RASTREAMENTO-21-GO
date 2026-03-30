import axios from 'axios';
import type { LoginRequest, LoginResponse, User } from '@/types/auth';
import type { Vehicle } from '@/types/vehicle';
import type { TraccarDevice, TraccarPosition } from '@/types/traccar';
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

export default api;
