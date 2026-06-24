import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from '@/lib/auth-store';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const { token, hydrated, hydrate } = useAuth();

  // Carrega o token salvo no boot.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

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

  if (!hydrated) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.orange} size="large" />
      </View>
    );
  }

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

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
