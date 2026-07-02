import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from '@/lib/auth-store';
import { colors } from '@/lib/theme';

// Mantém a splash nativa até o app estar pronto (hidratado). Sem isso, o app
// pode ficar preso numa tela em branco — bug que a App Review pegou no iPad.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const { token, hydrated, hydrate } = useAuth();

  // Carrega o token salvo no boot.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Esconde a splash só quando o app terminou de carregar.
  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync().catch(() => {});
  }, [hydrated]);

  // Gate de auth: manda pro login se sem token, ou pro app se logado.
  useEffect(() => {
    if (!hydrated) return;
    const inApp = segments[0] === '(tabs)' || segments[0] === 'vehicle';
    if (!token && inApp) {
      router.replace('/login');
    } else if (token && !inApp) {
      router.replace('/(tabs)');
    }
  }, [token, hydrated, segments, router]);

  // Enquanto não hidratou, a splash nativa cobre a tela.
  if (!hydrated) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
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
