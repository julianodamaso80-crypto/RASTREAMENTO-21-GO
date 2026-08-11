import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from '@/lib/auth-store';
import { useInternalAuth } from '@/lib/internal-auth-store';
import { resolveBootWorld } from '@/lib/session-keys';
import { colors } from '@/lib/theme';
import { diag } from '@/lib/diag';

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
      router.replace('/(tabs)');
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
