import axios from 'axios';
import type { JornadaDoDia } from '@/lib/historico';

/**
 * Client do associado na web. Usa as mesmas rotas /app/* do app Android e
 * iPhone — mesmo login, mesma senha, mesmos veículos. Token em chave própria
 * do localStorage para não derrubar a sessão do operador no mesmo navegador.
 */
const TOKEN_KEY = 'associate_token';

const http = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL + '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function unwrap<T>(payload: { data?: T } & T): T {
  return (payload as { data?: T }).data ?? (payload as T);
}

export interface AssociatePosition {
  latitude: number;
  longitude: number;
  speed: number;
  address: string | null;
  fixTime: string;
  ignition: boolean | null;
}

export interface AssociateVehicle {
  id: string;
  plate: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  vehicleType?: 'CAR' | 'MOTORCYCLE' | null;
  status?: string;
  position: AssociatePosition | null;
  connection: { status: string; lastUpdate: string | null } | null;
}

export interface AssociateMe {
  id: string;
  name: string;
  mustChangePassword: boolean;
}

export const associateApi = {
  getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  },
  logout() {
    localStorage.removeItem(TOKEN_KEY);
  },

  login: async (cpf: string, password: string) => {
    const res = await http.post('/app/auth/login', { cpf, password });
    const data = unwrap<{ accessToken: string; associate: AssociateMe }>(res.data);
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    return data;
  },
  me: async (): Promise<AssociateMe> => {
    const res = await http.get('/app/auth/me');
    return unwrap<AssociateMe>(res.data);
  },
  changePassword: async (currentPassword: string, newPassword: string) => {
    await http.post('/app/auth/change-password', { currentPassword, newPassword });
  },
  vehicles: async (): Promise<AssociateVehicle[]> => {
    const res = await http.get('/app/vehicles');
    return unwrap<AssociateVehicle[]>(res.data);
  },
  journey: async (vehicleId: string, date: string): Promise<JornadaDoDia> => {
    const res = await http.get(`/app/vehicles/${vehicleId}/journey`, { params: { date } });
    return unwrap<JornadaDoDia>(res.data);
  },
};
