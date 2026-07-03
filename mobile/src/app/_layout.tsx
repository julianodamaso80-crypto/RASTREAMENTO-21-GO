import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from '@/lib/auth-store';
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
  const { token, hydrated, hydrate } = useAuth();

  // Carrega o login salvo no boot.
  useEffect(() => {
    diag('03-effect-hydrate');
    hydrate();
  }, [hydrate]);

  // Gate de auth: protege as rotas conforme o login.
  useEffect(() => {
    if (!hydrated) return;
    const inApp = segments[0] === '(tabs)' || segments[0] === 'vehicle';
    if (!token && inApp) {
      router.replace('/login');
    } else if (token && !inApp) {
      router.replace('/(tabs)');
    }
  }, [token, hydrated, segments, router]);

  // SEMPRE renderiza — o app nunca fica preso em branco. A rota inicial "/"
  // (index) mostra um carregamento visível enquanto hidrata e então redireciona.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
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
