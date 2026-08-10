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
  const { token, hydrated, hydrate, mustChangePassword } = useAuth();

  // Carrega o login salvo no boot.
  useEffect(() => {
    diag('03-effect-hydrate');
    hydrate();
  }, [hydrate]);

  // Gate de auth: protege as rotas conforme o login.
  useEffect(() => {
    if (!hydrated) return;
    const inApp = segments[0] === '(tabs)' || segments[0] === 'vehicle';
    const naTrocaDeSenha = segments[0] === 'change-password';
    // Recuperação de senha é pra quem NÃO consegue entrar: fica fora do gate.
    const naRecuperacao = segments[0] === 'forgot-password';

    if (!token) {
      if (inApp || naTrocaDeSenha) router.replace('/login');
      return;
    }

    // Já logado não tem o que fazer na recuperação.
    if (naRecuperacao) {
      router.replace('/(tabs)');
      return;
    }

    // Primeiro acesso: nada do app abre antes de o cliente criar a senha dele.
    if (mustChangePassword) {
      if (!naTrocaDeSenha) router.replace('/change-password');
      return;
    }

    // Trocar a senha de novo, por vontade própria (pelo perfil), é permitido —
    // sem esta ressalva o gate expulsaria o usuário de volta pras abas.
    if (!inApp && !naTrocaDeSenha) router.replace('/(tabs)');
  }, [token, hydrated, mustChangePassword, segments, router]);

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
