import { useEffect, useRef, useState } from 'react';
import { AppState, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useInternalAuth } from '@/lib/internal-auth-store';
import { requestUnlock, shouldRelock } from '@/lib/biometrics';
import { colors } from '@/lib/theme';

const MAX_TENTATIVAS = 3;

export default function InternoLayout() {
  const router = useRouter();
  const { token, logout } = useInternalAuth();
  const [liberado, setLiberado] = useState(false);
  const ultimaAtividade = useRef<number | null>(null);
  const tentativas = useRef(0);

  async function desbloquear() {
    const r = await requestUnlock();
    if (r === 'granted') {
      tentativas.current = 0;
      ultimaAtividade.current = Date.now();
      setLiberado(true);
      return;
    }
    if (r === 'unavailable') {
      // Sem biometria e sem PIN no aparelho não existe "entrar assim mesmo":
      // derruba a sessão e obriga a senha do painel de novo.
      await logout();
      router.replace('/login');
      return;
    }
    tentativas.current += 1;
    if (tentativas.current >= MAX_TENTATIVAS) {
      await logout();
      router.replace('/login');
    }
  }

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    desbloquear();
  }, [token]);

  // Voltou do background depois de 5 minutos parado: pede de novo.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'background') {
        ultimaAtividade.current = Date.now();
        setLiberado(false);
        return;
      }
      if (estado === 'active' && !liberado) {
        if (shouldRelock(ultimaAtividade.current, Date.now())) {
          desbloquear();
        } else {
          setLiberado(true);
        }
      }
    });
    return () => sub.remove();
  }, [liberado]);

  if (!liberado) {
    return (
      <View style={styles.gate}>
        <ActivityIndicator size="large" color={colors.orange} />
        <Text style={styles.texto}>Confirme que é você para continuar</Text>
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
    gap: 16,
  },
  texto: { color: colors.white, fontSize: 15 },
});
