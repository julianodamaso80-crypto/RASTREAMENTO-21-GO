import { useEffect, useRef, useState } from 'react';
import { AppState, View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useInternalAuth } from '@/lib/internal-auth-store';
import { requestUnlock, shouldRelock, type UnlockResult } from '@/lib/biometrics';
import { colors } from '@/lib/theme';

const MAX_TENTATIVAS = 3;

export default function InternoLayout() {
  const router = useRouter();
  const { token, logout } = useInternalAuth();
  const [liberado, setLiberado] = useState(false);
  const ultimaAtividade = useRef<number | null>(null);
  const tentativas = useRef(0);
  const emAndamento = useRef(false);

  async function sair() {
    await logout();
    router.replace('/login');
  }

  async function desbloquear() {
    // Face ID leva o app a 'inactive' e a volta a 'active' pode disparar
    // desbloquear() de novo com o primeiro prompt ainda pendente.
    if (emAndamento.current) return;
    emAndamento.current = true;
    try {
      let r: UnlockResult;
      try {
        r = await requestUnlock();
      } catch {
        // requestUnlock rejeitado (prompt cancelado pelo SO etc.) não pode
        // travar o usuário no spinner pra sempre — conta como negado.
        r = 'denied';
      }

      if (r === 'granted') {
        tentativas.current = 0;
        ultimaAtividade.current = Date.now();
        // Pode resolver com o app já em segundo plano; sem essa checagem o
        // relock nunca é reconsultado quando o app volta ao primeiro plano.
        if (AppState.currentState === 'active') {
          setLiberado(true);
        }
        return;
      }
      if (r === 'unavailable') {
        // Sem biometria e sem PIN no aparelho não existe "entrar assim mesmo":
        // derruba a sessão e obriga a senha do painel de novo.
        await sair();
        return;
      }
      tentativas.current += 1;
      if (tentativas.current >= MAX_TENTATIVAS) {
        await sair();
      }
    } finally {
      emAndamento.current = false;
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
      // No iOS o snapshot do seletor de apps é tirado na transição por
      // 'inactive' — o painel com posições em tempo real não pode ficar
      // visível ali, então esconde no 'inactive' também, não só 'background'.
      if (estado === 'background' || estado === 'inactive') {
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
        <View style={styles.acoes}>
          <TouchableOpacity onPress={desbloquear} style={styles.botao}>
            <Text style={styles.botaoTexto}>Tentar de novo</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={sair} hitSlop={12}>
            <Text style={styles.sairTexto}>Sair</Text>
          </TouchableOpacity>
        </View>
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
  acoes: { alignItems: 'center', gap: 14, marginTop: 8 },
  botao: {
    backgroundColor: colors.orange,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  botaoTexto: { color: colors.white, fontSize: 15, fontWeight: '700' },
  sairTexto: { color: colors.orangeSoft, fontSize: 14, fontWeight: '600' },
});
