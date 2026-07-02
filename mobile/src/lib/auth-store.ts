import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'r21go.associate.token';
const NAME_KEY = 'r21go.associate.name';

interface AuthState {
  token: string | null;
  name: string | null;
  hydrated: boolean;
  /** Carrega token do SecureStore no boot. */
  hydrate: () => Promise<void>;
  signIn: (token: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  token: null,
  name: null,
  hydrated: false,

  hydrate: async () => {
    // NUNCA pode lançar: se o SecureStore falhar, o app precisa seguir pro login
    // mesmo assim (senão fica preso na tela de carregamento — bug que a Apple pegou).
    try {
      const [token, name] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(NAME_KEY),
      ]);
      set({ token, name, hydrated: true });
    } catch {
      set({ token: null, name: null, hydrated: true });
    }
  },

  signIn: async (token, name) => {
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, token),
      SecureStore.setItemAsync(NAME_KEY, name),
    ]);
    set({ token, name });
  },

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(NAME_KEY),
    ]);
    set({ token: null, name: null });
  },
}));
