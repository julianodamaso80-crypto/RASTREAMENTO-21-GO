import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/lib/auth-store';
import { useInternalAuth } from '@/lib/internal-auth-store';
import { resolveBootWorld } from '@/lib/session-keys';
import { colors } from '@/lib/theme';
import { diag } from '@/lib/diag';
import { registrarParaPush, rotaDoAviso } from '@/lib/push';

// Se algo crashar no render, o expo-router mostra uma tela de erro legível
// em vez de uma tela branca — assim conseguimos ver a causa.
export { ErrorBoundary } from 'expo-router';

// DIAGNÓSTICO: primeira linha de JS a executar quando o bundle carrega.
diag('01-module-loaded');

export default function RootLayout() {
  diag('02-root-render');
  const router = useRouter();
  const segments = useSegments();
  const { token, hydrated, hydrate, mustChangePassword, logout } = useAuth();
  const interno = useInternalAuth();

  // Carrega o login salvo no boot.
  useEffect(() => {
    diag('03-effect-hydrate');
    hydrate();
    interno.hydrate();
  }, [hydrate]);

  // Gate de auth: protege as rotas conforme o login.
  useEffect(() => {
    if (!hydrated || !interno.hydrated) return;

    const mundo = resolveBootWorld(token, interno.token);
    const noInterno = segments[0] === 'interno';
    const inApp = segments[0] === '(tabs)' || segments[0] === 'vehicle';
    const naTrocaDeSenha = segments[0] === 'change-password';
    const naRecuperacao = segments[0] === 'forgot-password';

    // Estado impossível (os dois tokens vivos): apaga tudo e volta pro login.
    if (token && interno.token) {
      logout();
      interno.logout();
      router.replace('/login');
      return;
    }

    if (mundo === 'internal') {
      if (!noInterno) router.replace('/interno/painel');
      return;
    }

    if (mundo === 'none') {
      if (inApp || naTrocaDeSenha || noInterno) router.replace('/login');
      return;
    }

    // Daqui pra baixo é o mundo do associado — regras idênticas às de hoje.
    if (noInterno) {
      // Deep link pra /interno/* não pode furar a troca de senha obrigatória
      // passando por /(tabs) antes — manda direto pro destino final certo.
      router.replace(mustChangePassword ? '/change-password' : '/(tabs)');
      return;
    }
    if (naRecuperacao) {
      router.replace('/(tabs)');
      return;
    }
    if (mustChangePassword) {
      if (!naTrocaDeSenha) router.replace('/change-password');
      return;
    }
    if (!inApp && !naTrocaDeSenha) router.replace('/(tabs)');
  }, [
    token,
    interno.token,
    hydrated,
    interno.hydrated,
    mustChangePassword,
    segments,
    router,
  ]);

  // Push do boleto: só faz sentido pro associado logado, e nunca pode
  // atrapalhar o boot — registrarParaPush já engole os próprios erros.
  useEffect(() => {
    if (!hydrated || !token || interno.token) return;
    registrarParaPush();
    const sub = Notifications.addNotificationResponseReceivedListener((resposta) => {
      const rota = rotaDoAviso(resposta.notification.request.content.data);
      if (rota) router.push(rota as never);
    });
    return () => sub.remove();
  }, [hydrated, token, interno.token, router]);

  // SEMPRE renderiza — o app nunca fica preso em branco. A rota inicial "/"
  // (index) mostra um carregamento visível enquanto hidrata e então redireciona.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="change-password" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="interno" />
        <Stack.Screen
          name="vehicle/[id]"
          options={{
            headerShown: true,
            title: 'Histórico',
            headerTintColor: colors.navy,
          }}
        />
      </Stack>
    </GestureHandlerRootView>
  );
}
