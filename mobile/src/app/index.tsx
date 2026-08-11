import { Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from '@/lib/auth-store';
import { useInternalAuth } from '@/lib/internal-auth-store';
import { resolveBootWorld } from '@/lib/session-keys';
import { colors } from '@/lib/theme';
import { diag } from '@/lib/diag';

/**
 * Rota inicial "/". Mostra carregamento visível (nunca tela branca) enquanto as
 * duas sessões são lidas, e então abre o mundo certo.
 */
export default function Index() {
  diag('04-index-render');
  const { token, hydrated } = useAuth();
  const interno = useInternalAuth();

  if (!hydrated || !interno.hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  const mundo = resolveBootWorld(token, interno.token);
  if (mundo === 'internal') return <Redirect href="/interno/painel" />;
  if (mundo === 'associate') return <Redirect href="/(tabs)" />;
  return <Redirect href="/login" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
  },
});
