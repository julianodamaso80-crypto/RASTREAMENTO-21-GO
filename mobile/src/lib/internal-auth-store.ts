import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import {
  ASSOCIATE_MUST_CHANGE_KEY,
  ASSOCIATE_NAME_KEY,
  ASSOCIATE_TOKEN_KEY,
  INTERNAL_TOKEN_KEY,
  INTERNAL_USER_KEY,
} from './session-keys';

export interface InternalUser {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Telas que este usuário pode ver. Vazio = todas as do perfil dele. */
  allowedRoutes: string[];
}

interface InternalAuthState {
  token: string | null;
  user: InternalUser | null;
  hydrated: boolean;
  /**
   * Biometria já aprovada nesta sessão. Vive no store — não num ref do
   * gate biométrico — porque mais de uma tela pode encerrar a sessão
   * interna (o próprio gate e o painel) e as duas precisam derrubar essa
   * flag pela mesma porta: `logout()`. Um ref local em cada tela criaria
   * duas fontes de verdade independentes.
   */
  jaAutorizou: boolean;
  hydrate: () => Promise<void>;
  signIn: (token: string, user: InternalUser) => Promise<void>;
  marcarAutorizado: () => void;
  logout: () => Promise<void>;
}

/** Apaga qualquer resquício do mundo do associado. Uma sessão viva por vez. */
async function wipeAssociateSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(ASSOCIATE_TOKEN_KEY),
    SecureStore.deleteItemAsync(ASSOCIATE_NAME_KEY),
    SecureStore.deleteItemAsync(ASSOCIATE_MUST_CHANGE_KEY),
  ]);
}

export const useInternalAuth = create<InternalAuthState>((set) => ({
  token: null,
  user: null,
  hydrated: false,
  jaAutorizou: false,

  hydrate: async () => {
    // Mesmo failsafe do store do associado: SecureStore travado no iPhone não
    // pode prender o app numa tela de carregamento eterna.
    const failsafe = setTimeout(() => {
      if (!useInternalAuth.getState().hydrated) {
        set({ token: null, user: null, hydrated: true });
      }
    }, 4000);
    try {
      const [token, rawUser] = await Promise.all([
        SecureStore.getItemAsync(INTERNAL_TOKEN_KEY),
        SecureStore.getItemAsync(INTERNAL_USER_KEY),
      ]);
      clearTimeout(failsafe);
      set({
        token,
        user: rawUser ? (JSON.parse(rawUser) as InternalUser) : null,
        hydrated: true,
      });
    } catch {
      clearTimeout(failsafe);
      set({ token: null, user: null, hydrated: true });
    }
  },

  signIn: async (token, user) => {
    // Entrar num mundo apaga o outro — invariante de sessão única.
    await wipeAssociateSession();
    await Promise.all([
      SecureStore.setItemAsync(INTERNAL_TOKEN_KEY, token),
      SecureStore.setItemAsync(INTERNAL_USER_KEY, JSON.stringify(user)),
    ]);
    // Sessão nova começa sem biometria aprovada — o gate decide isso, nunca o login.
    set({ token, user, jaAutorizou: false });
  },

  marcarAutorizado: () => set({ jaAutorizou: true }),

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(INTERNAL_TOKEN_KEY),
      SecureStore.deleteItemAsync(INTERNAL_USER_KEY),
    ]);
    // Qualquer encerramento de sessão (gate ou painel) passa por aqui — é o
    // único lugar que precisa zerar jaAutorizou pra próxima entrada exigir
    // biometria de novo.
    set({ token: null, user: null, jaAutorizou: false });
  },
}));
