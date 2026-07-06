import axios from 'axios';
import Constants from 'expo-constants';
import { useAuth } from './auth-store';

/**
 * Base URL da API. Em produção aponta pro backend real; em dev pode ser
 * sobrescrito via extra.apiUrl no app.json ou variável EXPO_PUBLIC_API_URL.
 */
const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
  'https://api.trackgo.site/api/v1';

export const api = axios.create({ baseURL: API_URL, timeout: 15000 });

// Injeta o token do associado em toda request.
api.interceptors.request.use((config) => {
  const token = useAuth.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// O backend (NestJS) embrulha toda resposta de sucesso em { data: <payload> }.
// Desembrulha aqui pra que os `.then((r) => r.data)` recebam o payload real
// (sem isso, login/me/vehicles/etc vêm undefined e o app acha que deu erro).
// 401 → token inválido/expirado: desloga e volta pro login.
api.interceptors.response.use(
  (r) => {
    const body: unknown = r.data;
    if (body && typeof body === 'object' && 'data' in body) {
      r.data = (body as { data: unknown }).data;
    }
    return r;
  },
  async (error) => {
    if (error?.response?.status === 401) {
      await useAuth.getState().logout();
    }
    return Promise.reject(error);
  },
);

// ---- Tipos do contrato com /app/* ----
export interface Position {
  latitude: number;
  longitude: number;
  speed: number; // km/h
  course: number;
  address: string | null;
  fixTime: string; // momento real do GPS
  ignition: boolean | null;
  motion: boolean | null;
  battery: number | null;
}

export interface Connection {
  status: string; // online | offline | unknown
  lastUpdate: string | null;
}

export interface Vehicle {
  id: string;
  plate: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  status: string;
  traccarDeviceId: number | null;
  position: Position | null;
  connection: Connection | null;
}

export interface Alert {
  id: string;
  type: string;
  severity: string;
  message: string;
  status: string;
  read: boolean;
  createdAt: string;
  vehicle: { id: string; plate: string } | null;
}

export interface AssociateProfile {
  id: string;
  name: string;
  cpf: string;
  email: string | null;
  phone: string | null;
  tenant: { id: string; name: string; logoUrl: string | null; primaryColor: string };
  _count: { vehicles: number };
}

export const AppApi = {
  login: (cpf: string, password: string) =>
    api
      .post<{ accessToken: string; associate: { id: string; name: string } }>(
        '/app/auth/login',
        { cpf, password },
      )
      .then((r) => r.data),

  me: () => api.get<AssociateProfile>('/app/auth/me').then((r) => r.data),

  vehicles: () => api.get<Vehicle[]>('/app/vehicles').then((r) => r.data),

  history: (vehicleId: string, from: string, to: string) =>
    api
      .get<Position[]>(`/app/vehicles/${vehicleId}/history`, {
        params: { from, to },
      })
      .then((r) => r.data),

  alerts: (limit = 50) =>
    api.get<Alert[]>('/app/alerts', { params: { limit } }).then((r) => r.data),
};
