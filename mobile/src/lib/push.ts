import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { AppApi } from './api';

/** Só estas rotas podem vir num push. Qualquer outra coisa é ignorada. */
const ROTAS_PERMITIDAS = ['/boletos'];

export function rotaDoAviso(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const rota = (data as { rota?: unknown }).rota;
  return typeof rota === 'string' && ROTAS_PERMITIDAS.includes(rota) ? rota : null;
}

/**
 * Pede a permissão e registra o aparelho. Recusa não é erro: o associado
 * continua vendo o boleto ao abrir a aba.
 */
export async function registrarParaPush(): Promise<void> {
  try {
    const atual = await Notifications.getPermissionsAsync();
    const permissao = atual.granted
      ? atual
      : await Notifications.requestPermissionsAsync();
    if (!permissao.granted) return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await AppApi.registrarPush(token.data, Platform.OS);
  } catch {
    // Sem push o app segue inteiro. Nunca derrubar o boot por causa disso.
  }
}
