import axios from 'axios';
import Constants from 'expo-constants';
import { useInternalAuth, InternalUser } from './internal-auth-store';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
  'https://api.trackgo.site/api/v1';

/**
 * Cliente do MUNDO INTERNO. Instância separada da do associado de propósito:
 * cada uma só conhece o próprio token, então nenhuma tela consegue, nem por
 * engano, mandar credencial de um mundo pro endpoint do outro.
 */
export const internalApi = axios.create({ baseURL: API_URL, timeout: 15000 });

internalApi.interceptors.request.use((config) => {
  const token = useInternalAuth.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

internalApi.interceptors.response.use(
  (r) => {
    const body: unknown = r.data;
    if (body && typeof body === 'object' && 'data' in body) {
      r.data = (body as { data: unknown }).data;
    }
    return r;
  },
  async (error) => {
    if (error?.response?.status === 401) {
      await useInternalAuth.getState().logout();
    }
    return Promise.reject(error);
  },
);

export const InternalApi = {
  login: (email: string, password: string) =>
    internalApi
      .post<{ accessToken: string; user: InternalUser }>('/auth/login', {
        email,
        password,
      })
      .then((r) => r.data),
};
