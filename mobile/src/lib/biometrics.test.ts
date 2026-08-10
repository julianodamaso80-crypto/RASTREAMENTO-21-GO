import * as LocalAuthentication from 'expo-local-authentication';
import { RELOCK_AFTER_MS, requestUnlock, shouldRelock } from './biometrics';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

const hasHardwareAsyncMock = LocalAuthentication.hasHardwareAsync as jest.Mock;
const isEnrolledAsyncMock = LocalAuthentication.isEnrolledAsync as jest.Mock;
const authenticateAsyncMock = LocalAuthentication.authenticateAsync as jest.Mock;

describe('shouldRelock', () => {
  const agora = 1_000_000_000;

  it('sem registro de atividade, bloqueia', () => {
    expect(shouldRelock(null, agora)).toBe(true);
  });

  it('voltou em menos de 5 minutos: não pede de novo', () => {
    expect(shouldRelock(agora - 60_000, agora)).toBe(false);
  });

  it('voltou depois de 5 minutos: pede biometria', () => {
    expect(shouldRelock(agora - RELOCK_AFTER_MS - 1, agora)).toBe(true);
  });

  it('exatamente no limite ainda não pede', () => {
    expect(shouldRelock(agora - RELOCK_AFTER_MS, agora)).toBe(false);
  });
});

describe('requestUnlock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sem hardware e sem cadastro: retorna unavailable e não chama o desafio', async () => {
    hasHardwareAsyncMock.mockResolvedValue(false);
    isEnrolledAsyncMock.mockResolvedValue(false);

    const resultado = await requestUnlock();

    expect(resultado).toBe('unavailable');
    expect(authenticateAsyncMock).not.toHaveBeenCalled();
  });

  it('desafio aceito: retorna granted', async () => {
    hasHardwareAsyncMock.mockResolvedValue(true);
    isEnrolledAsyncMock.mockResolvedValue(true);
    authenticateAsyncMock.mockResolvedValue({ success: true });

    const resultado = await requestUnlock();

    expect(resultado).toBe('granted');
  });

  it('desafio recusado: retorna denied', async () => {
    hasHardwareAsyncMock.mockResolvedValue(true);
    isEnrolledAsyncMock.mockResolvedValue(true);
    authenticateAsyncMock.mockResolvedValue({ success: false, error: 'user_cancel' });

    const resultado = await requestUnlock();

    expect(resultado).toBe('denied');
  });

  it('fallback pro PIN do sistema está ligado (disableDeviceFallback: false)', async () => {
    hasHardwareAsyncMock.mockResolvedValue(true);
    isEnrolledAsyncMock.mockResolvedValue(true);
    authenticateAsyncMock.mockResolvedValue({ success: true });

    await requestUnlock();

    expect(authenticateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false })
    );
  });
});
