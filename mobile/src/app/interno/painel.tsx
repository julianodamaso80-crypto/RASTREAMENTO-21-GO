import { useState } from 'react';
import { Linking, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { useInternalAuth } from '@/lib/internal-auth-store';
import { PAINEL_ORIGIN, ehDoPainel, ehLoginDoPainel } from '@/lib/painel-urls';
import { colors } from '@/lib/theme';

export default function PainelInterno() {
  const router = useRouter();
  const { token, user, logout } = useInternalAuth();
  const [tentativaChave, setTentativaChave] = useState(0);

  /**
   * O painel lê a sessão de `localStorage.token` (frontend/dashboard/src/lib/api.ts).
   * Escrevemos antes do primeiro script da página rodar, então ele abre já
   * logado — o funcionário digita a senha uma vez, no app, e nunca dentro da web.
   */
  const injecao = `
    (function () {
      try {
        localStorage.setItem('token', ${JSON.stringify(token ?? '')});
      } catch (e) {
        try { window.ReactNativeWebView.postMessage('injecao-falhou'); } catch (e2) {}
      }
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
        key={tentativaChave}
        source={{ uri: PAINEL_ORIGIN }}
        injectedJavaScriptBeforeContentLoaded={injecao}
        // Nada sobrevive ao fim da sessão: celular emprestado não reabre o
        // painel de quem usou antes.
        incognito
        // Segunda barreira além do onShouldStartLoadWithRequest abaixo: esse
        // callback tem lacunas conhecidas (iframe, target="_blank" no
        // Android) e a WebView carrega sessão injetada — a checagem precisa
        // ser dupla.
        originWhitelist={[PAINEL_ORIGIN]}
        onMessage={(evento) => {
          if (evento.nativeEvent.data === 'injecao-falhou') {
            console.warn('[painel] falha ao injetar a sessão no localStorage do painel');
          }
        }}
        // pushState do Next (ex.: token some do localStorage e o layout do
        // painel chama router.push('/login')) não passa por
        // onShouldStartLoadWithRequest no iOS — só por aqui.
        onNavigationStateChange={(nav) => {
          if (ehLoginDoPainel(nav.url)) sair();
        }}
        onShouldStartLoadWithRequest={(req) => {
          if (ehDoPainel(req.url)) {
            // Sessão morta: o painel tenta mandar pro login dele (navegação
            // via location.href). Quem manda no login é o app.
            if (ehLoginDoPainel(req.url)) {
              sair();
              return false;
            }
            return true;
          }
          // blob:/data: são download do próprio painel (relatório
          // exportado), não navegação pra um terceiro — deixa passar.
          if (req.url.startsWith('blob:') || req.url.startsWith('data:')) return true;
          // Qualquer outro destino (Waze, Google Maps etc.) sai pro
          // navegador/app do sistema — a WebView autenticada nunca renderiza
          // terceiro.
          if (req.url.startsWith('http:') || req.url.startsWith('https:')) {
            Linking.openURL(req.url).catch(() => {});
          }
          return false;
        }}
        renderError={() => (
          <View style={styles.erro}>
            <Text style={styles.erroTitulo}>Não foi possível abrir o painel</Text>
            <Text style={styles.erroTexto}>Verifique sua conexão e tente de novo.</Text>
            <TouchableOpacity
              onPress={() => setTentativaChave((c) => c + 1)}
              style={styles.erroBotao}
            >
              <Text style={styles.erroBotaoTexto}>Tentar de novo</Text>
            </TouchableOpacity>
          </View>
        )}
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
  erro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    paddingHorizontal: 24,
    gap: 12,
  },
  erroTitulo: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  erroTexto: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  erroBotao: {
    marginTop: 8,
    backgroundColor: colors.orange,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  erroBotaoTexto: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
