import { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { useInternalAuth } from '@/lib/internal-auth-store';
import { colors } from '@/lib/theme';

const PAINEL_ORIGIN = 'https://trackgo.site';

export default function PainelInterno() {
  const router = useRouter();
  const { token, user, logout } = useInternalAuth();
  const webRef = useRef<WebView>(null);

  /**
   * O painel lê a sessão de `localStorage.token` (frontend/dashboard/src/lib/api.ts).
   * Escrevemos antes do primeiro script da página rodar, então ele abre já
   * logado — o funcionário digita a senha uma vez, no app, e nunca dentro da web.
   */
  const injecao = `
    (function () {
      try {
        localStorage.setItem('token', ${JSON.stringify(token ?? '')});
        localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user ?? null))});
      } catch (e) {}
    })();
    true;
  `;

  async function sair() {
    await logout();
    router.replace('/login');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.barra}>
        <Text style={styles.nome} numberOfLines={1}>
          {user?.name ?? 'Painel'}
        </Text>
        <TouchableOpacity onPress={sair} hitSlop={12}>
          <Text style={styles.sair}>Sair</Text>
        </TouchableOpacity>
      </View>

      <WebView
        ref={webRef}
        source={{ uri: PAINEL_ORIGIN }}
        injectedJavaScriptBeforeContentLoaded={injecao}
        // Nada sobrevive ao fim da sessão: celular emprestado não reabre o
        // painel de quem usou antes.
        incognito
        // Só o painel carrega aqui dentro. Qualquer outro destino sai pro
        // navegador do sistema — WebView autenticada nunca renderiza terceiro.
        onShouldStartLoadWithRequest={(req) => {
          if (!req.url.startsWith(PAINEL_ORIGIN)) return false;
          // Sessão morta: o painel tenta mandar pro login dele. Quem manda no
          // login é o app — duas fontes de sessão é onde a bagunça vira vazamento.
          if (req.url.startsWith(`${PAINEL_ORIGIN}/login`)) {
            sair();
            return false;
          }
          return true;
        }}
        style={styles.web}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.navy },
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.navy,
  },
  nome: { color: colors.white, fontSize: 15, fontWeight: '600', flex: 1 },
  sair: { color: colors.orange, fontSize: 15, fontWeight: '700' },
  web: { flex: 1, backgroundColor: colors.white },
});
