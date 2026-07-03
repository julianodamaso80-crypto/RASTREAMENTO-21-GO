import { Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from '@/lib/auth-store';
import { colors } from '@/lib/theme';

/**
 * Rota inicial "/". Mostra um carregamento visível (nunca tela branca) enquanto
 * o login salvo é lido, e então redireciona pro app ou pro login.
 */
export default function Index() {
  const { token, hydrated } = useAuth();

  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  return <Redirect href={token ? '/(tabs)' : '/login'} />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
  },
});
