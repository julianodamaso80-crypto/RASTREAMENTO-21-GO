import * as SecureStore from 'expo-secure-store';
import { useInternalAuth, type InternalUser } from './internal-auth-store';
import {
  ASSOCIATE_MUST_CHANGE_KEY,
  ASSOCIATE_NAME_KEY,
  ASSOCIATE_TOKEN_KEY,
  INTERNAL_TOKEN_KEY,
  INTERNAL_USER_KEY,
} from './session-keys';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const secureStoreMock = SecureStore as jest.Mocked<typeof SecureStore>;

const usuarioInterno: InternalUser = {
  id: 'u1',
  name: 'Operador Teste',
  email: 'operador@trackgo.site',
  role: 'ADMIN',
  allowedRoutes: [],
};

describe('useInternalAuth', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Store é singleton do zustand — precisa voltar ao estado inicial a cada teste.
    useInternalAuth.setState({ token: null, user: null, hydrated: false });
  });

  describe('signIn', () => {
    it('apaga as três chaves do associado no SecureStore', async () => {
      secureStoreMock.deleteItemAsync.mockResolvedValue();
      secureStoreMock.setItemAsync.mockResolvedValue();

      await useInternalAuth.getState().signIn('token-interno', usuarioInterno);

      expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(ASSOCIATE_TOKEN_KEY);
      expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(ASSOCIATE_NAME_KEY);
      expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(ASSOCIATE_MUST_CHANGE_KEY);
    });

    it('apaga a sessão do associado ANTES de gravar as chaves internas — reordenar isso reabre duas sessões vivas ao mesmo tempo', async () => {
      const ordem: string[] = [];
      secureStoreMock.deleteItemAsync.mockImplementation(async (key: string) => {
        ordem.push(`delete:${key}`);
      });
      secureStoreMock.setItemAsync.mockImplementation(async (key: string) => {
        ordem.push(`set:${key}`);
      });

      await useInternalAuth.getState().signIn('token-interno', usuarioInterno);

      const ultimoDeleteAssociado = Math.max(
        ordem.indexOf(`delete:${ASSOCIATE_TOKEN_KEY}`),
        ordem.indexOf(`delete:${ASSOCIATE_NAME_KEY}`),
        ordem.indexOf(`delete:${ASSOCIATE_MUST_CHANGE_KEY}`),
      );
      const primeiroSetInterno = Math.min(
        ordem.indexOf(`set:${INTERNAL_TOKEN_KEY}`),
        ordem.indexOf(`set:${INTERNAL_USER_KEY}`),
      );

      // Se wipeAssociateSession() sumir ou for movida pra depois, os deletes do
      // associado não vão aparecer (índice -1) ou vão vir depois dos sets — os
      // dois casos precisam derrubar este teste.
      expect(ultimoDeleteAssociado).toBeGreaterThanOrEqual(0);
      expect(primeiroSetInterno).toBeGreaterThanOrEqual(0);
      expect(ultimoDeleteAssociado).toBeLessThan(primeiroSetInterno);
    });

    it('grava token e usuário internos no SecureStore e no estado do store', async () => {
      secureStoreMock.deleteItemAsync.mockResolvedValue();
      secureStoreMock.setItemAsync.mockResolvedValue();

      await useInternalAuth.getState().signIn('token-interno', usuarioInterno);

      expect(secureStoreMock.setItemAsync).toHaveBeenCalledWith(INTERNAL_TOKEN_KEY, 'token-interno');
      expect(secureStoreMock.setItemAsync).toHaveBeenCalledWith(
        INTERNAL_USER_KEY,
        JSON.stringify(usuarioInterno),
      );

      const estado = useInternalAuth.getState();
      expect(estado.token).toBe('token-interno');
      expect(estado.user).toEqual(usuarioInterno);
    });
  });

  describe('logout', () => {
    it('apaga as duas chaves internas e zera o estado', async () => {
      secureStoreMock.deleteItemAsync.mockResolvedValue();
      useInternalAuth.setState({ token: 'token-interno', user: usuarioInterno, hydrated: true });

      await useInternalAuth.getState().logout();

      expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(INTERNAL_TOKEN_KEY);
      expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(INTERNAL_USER_KEY);

      const estado = useInternalAuth.getState();
      expect(estado.token).toBeNull();
      expect(estado.user).toBeNull();
    });
  });

  describe('hydrate', () => {
    it('sobrevive a JSON de usuário corrompido: termina hydrated com sessão limpa, sem lançar', async () => {
      secureStoreMock.getItemAsync.mockImplementation(async (key: string) => {
        if (key === INTERNAL_TOKEN_KEY) return 'token-persistido';
        if (key === INTERNAL_USER_KEY) return '{json-invalido';
        return null;
      });

      await expect(useInternalAuth.getState().hydrate()).resolves.not.toThrow();

      const estado = useInternalAuth.getState();
      expect(estado.hydrated).toBe(true);
      expect(estado.token).toBeNull();
      expect(estado.user).toBeNull();
    });
  });
});
