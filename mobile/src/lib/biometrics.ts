import * as LocalAuthentication from 'expo-local-authentication';

/** Cinco minutos parado e o painel de trabalho pede a digital de novo. */
export const RELOCK_AFTER_MS = 5 * 60 * 1000;

export function shouldRelock(lastActiveAt: number | null, now: number): boolean {
  if (lastActiveAt === null) return true;
  return now - lastActiveAt > RELOCK_AFTER_MS;
}

export type UnlockResult = 'granted' | 'denied' | 'unavailable';

/**
 * Portão do mundo interno.
 *
 * `disableDeviceFallback: false` de propósito: aparelho sem digital cadastrada
 * cai no PIN do sistema em vez de ficar sem trava nenhuma. Quando não há nem
 * hardware nem PIN, devolvemos 'unavailable' — e quem chama exige a senha do
 * painel. Em nenhum caminho existe "entrar sem provar nada".
 */
export async function requestUnlock(): Promise<UnlockResult> {
  const temHardware = await LocalAuthentication.hasHardwareAsync();
  const temCadastro = await LocalAuthentication.isEnrolledAsync();
  if (!temHardware && !temCadastro) return 'unavailable';

  const resultado = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Confirme que é você para abrir o painel de trabalho',
    cancelLabel: 'Cancelar',
    disableDeviceFallback: false,
  });

  return resultado.success ? 'granted' : 'denied';
}
