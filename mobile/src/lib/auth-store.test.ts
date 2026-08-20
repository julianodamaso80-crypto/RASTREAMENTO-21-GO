import * as SecureStore from 'expo-secure-store';
import { useAuth } from './auth-store';
import { useInternalAuth, type InternalUser } from './internal-auth-store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const secureStore = SecureStore as jest.Mocked<typeof SecureStore>;

const usuarioInterno: InternalUser = {
  id: 'u1',
  name: 'Operador',
  email: 'operador@trackgo.site',
  role: 'ADMIN',
  allowedRoutes: [],
};

/**
 * Cofre do aparelho quebrado (Android Keystore com problema) não pode impedir
 * de entrar. Aconteceu em produção: a API autenticava (last_login_at gravado
 * no banco) e a tela mostrava "não foi possível entrar", porque gravar a
 * sessão era condição pra entrar e a gravação estourava.
 */
describe('sessão quando o cofre do aparelho falha', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    useAuth.setState({ token: null, name: null, mustChangePassword: false, hydrated: false });
    useInternalAuth.setState({ token: null, user: null, hydrated: false, jaAutorizou: false });
  });

  it('associado entra mesmo se o cofre recusar a gravação', async () => {
    secureStore.setItemAsync.mockRejectedValue(new Error('Could not encrypt the value'));

    await expect(
      useAuth.getState().signIn('token-abc', 'JORGE LUIS DA SILVA', true),
    ).resolves.toBeUndefined();

    expect(useAuth.getState().token).toBe('token-abc');
    expect(useAuth.getState().name).toBe('JORGE LUIS DA SILVA');
    expect(useAuth.getState().mustChangePassword).toBe(true);
  });

  it('time interno entra mesmo se o cofre recusar a gravação', async () => {
    secureStore.setItemAsync.mockRejectedValue(new Error('Could not encrypt the value'));
    secureStore.deleteItemAsync.mockRejectedValue(new Error('Could not access keystore'));

    await expect(
      useInternalAuth.getState().signIn('token-interno', usuarioInterno),
    ).resolves.toBeUndefined();

    expect(useInternalAuth.getState().token).toBe('token-interno');
    expect(useInternalAuth.getState().user?.email).toBe('operador@trackgo.site');
  });

  it('com o cofre são, continua gravando as três chaves do associado', async () => {
    secureStore.setItemAsync.mockResolvedValue();

    await useAuth.getState().signIn('token-abc', 'JORGE', false);

    expect(secureStore.setItemAsync).toHaveBeenCalledTimes(3);
  });

  it('sair não trava se o cofre recusar apagar', async () => {
    secureStore.deleteItemAsync.mockRejectedValue(new Error('keystore'));
    useAuth.setState({ token: 't', name: 'n', mustChangePassword: false, hydrated: true });

    await expect(useAuth.getState().logout()).resolves.toBeUndefined();
    expect(useAuth.getState().token).toBeNull();
  });
});
