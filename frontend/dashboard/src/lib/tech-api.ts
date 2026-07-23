import axios from 'axios';
import type {
  TechAssignment,
  TechMe,
  TechLoginResponse,
  TechSignal,
  TechRoute,
} from '@/types/tech';
import type { HinovaLookup, StockAssociateResult } from '@/types/stock';

/**
 * Client do PWA do técnico. Token em chave própria do localStorage — assim
 * operador e técnico podem usar o mesmo navegador sem derrubar um ao outro.
 */
const TOKEN_KEY = 'tech_token';

const techHttp = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL + '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

techHttp.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

techHttp.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname.startsWith('/tecnico')) {
        window.location.href = '/tecnico';
      }
    }
    return Promise.reject(error);
  },
);

// O backend envelopa respostas em { data }, mas nem todo interceptor cobre 100%
// das rotas — o fallback mantém o PWA funcionando nos dois formatos.
function unwrap<T>(payload: { data?: T } & T): T {
  return (payload as { data?: T }).data ?? (payload as T);
}

export const techApi = {
  tokenKey: TOKEN_KEY,

  getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  },
  setToken(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  logout() {
    localStorage.removeItem(TOKEN_KEY);
  },

  login: async (cpf: string, password: string): Promise<TechLoginResponse> => {
    const res = await techHttp.post('/tech/auth/login', { cpf, password });
    return unwrap<TechLoginResponse>(res.data);
  },
  me: async (): Promise<TechMe> => {
    const res = await techHttp.get('/tech/auth/me');
    return unwrap<TechMe>(res.data);
  },
  changePassword: async (
    currentPassword: string,
    newPassword: string,
  ): Promise<void> => {
    await techHttp.post('/tech/auth/change-password', {
      currentPassword,
      newPassword,
    });
  },
  assignments: async (): Promise<TechAssignment[]> => {
    const res = await techHttp.get('/tech/assignments');
    return unwrap<TechAssignment[]>(res.data);
  },
  route: async (): Promise<TechRoute | null> => {
    const res = await techHttp.get('/tech/route');
    return unwrap<TechRoute | null>(res.data);
  },
  lookup: async (placa: string): Promise<HinovaLookup> => {
    const res = await techHttp.get('/tech/lookup', { params: { placa } });
    return unwrap<HinovaLookup>(res.data);
  },
  signal: async (id: string): Promise<TechSignal> => {
    const res = await techHttp.get(`/tech/assignments/${id}/signal`);
    return unwrap<TechSignal>(res.data);
  },
  finish: async (
    id: string,
    payload: { placa: string; installLocation: string; notes?: string },
  ): Promise<StockAssociateResult> => {
    const res = await techHttp.post(`/tech/assignments/${id}/finish`, payload);
    return unwrap<StockAssociateResult>(res.data);
  },
};
