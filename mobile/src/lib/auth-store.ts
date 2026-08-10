import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { diag } from './diag';

import {
  ASSOCIATE_TOKEN_KEY as TOKEN_KEY,
  ASSOCIATE_NAME_KEY as NAME_KEY,
  ASSOCIATE_MUST_CHANGE_KEY as MUST_CHANGE_KEY,
} from './session-keys';

interface AuthState {
  token: string | null;
  name: string | null;
  /**
   * Primeiro acesso feito com o CPF como senha. Persistido junto do token
   * porque o gate de rota roda no boot, antes de qualquer chamada de rede.
   */
  mustChangePassword: boolean;
  hydrated: boolean;
  /** Carrega token do SecureStore no boot. */
  hydrate: () => Promise<void>;
  signIn: (
    token: string,
    name: string,
    mustChangePassword: boolean,
  ) => Promise<void>;
  setMustChangePassword: (value: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  token: null,
  name: null,
  mustChangePassword: false,
  hydrated: false,

  hydrate: async () => {
    // NUNCA pode ficar pendente: se o SecureStore travar/falhar no iPhone, o app
    // precisa destravar mesmo assim (senão fica preso na tela de carregamento —
    // bug que a Apple pegou). Failsafe de 4s garante que hydrated sempre vira true.
    diag('06-hydrate-start');
    const failsafe = setTimeout(() => {
      if (!useAuth.getState().hydrated) {
        diag('08-hydrate-failsafe');
        set({ token: null, name: null, mustChangePassword: false, hydrated: true });
      }
    }, 4000);
    try {
      const [token, name, mustChange] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(NAME_KEY),
        SecureStore.getItemAsync(MUST_CHANGE_KEY),
      ]);
      clearTimeout(failsafe);
      diag('07-hydrate-done');
      set({
        token,
        name,
        mustChangePassword: mustChange === '1',
        hydrated: true,
      });
    } catch {
      clearTimeout(failsafe);
      diag('07-hydrate-error');
      set({ token: null, name: null, mustChangePassword: false, hydrated: true });
    }
  },

  signIn: async (token, name, mustChangePassword) => {
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, token),
      SecureStore.setItemAsync(NAME_KEY, name),
      SecureStore.setItemAsync(MUST_CHANGE_KEY, mustChangePassword ? '1' : '0'),
    ]);
    set({ token, name, mustChangePassword });
  },

  setMustChangePassword: async (value) => {
    await SecureStore.setItemAsync(MUST_CHANGE_KEY, value ? '1' : '0');
    set({ mustChangePassword: value });
  },

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(NAME_KEY),
      SecureStore.deleteItemAsync(MUST_CHANGE_KEY),
    ]);
    set({ token: null, name: null, mustChangePassword: false });
  },
}));
