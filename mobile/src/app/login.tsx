import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert as RNAlert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BrandLockup } from '@/components/brand-logo';
import { AppApi } from '@/lib/api';
import { InternalApi } from '@/lib/internal-api';
import { useAuth } from '@/lib/auth-store';
import { useInternalAuth } from '@/lib/internal-auth-store';
import { resolveLoginTarget } from '@/lib/login-router';
import { maskCpf, onlyDigits } from '@/lib/format';
import { colors, radii } from '@/lib/theme';
import { diag } from '@/lib/diag';

export default function LoginScreen() {
  diag('05-login-render');
  const router = useRouter();
  const signInAssociado = useAuth((s) => s.signIn);
  const signInInterno = useInternalAuth((s) => s.signIn);
  const [identificador, setIdentificador] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const destino = resolveLoginTarget(identificador);
  const canSubmit = destino !== 'invalid' && password.length >= 6;

  /**
   * Máscara de CPF só enquanto o texto for numérico. No instante em que o
   * usuário digita uma letra ou arroba, o campo vira e-mail e para de mascarar.
   */
  function handleChange(texto: string) {
    const pareceCpf = /^[\d.\-\s]*$/.test(texto);
    setIdentificador(pareceCpf ? maskCpf(texto) : texto);
  }

  async function handleLogin() {
    if (!canSubmit || loading) return;
    setLoading(true);
    try {
      if (destino === 'associate') {
        const { accessToken, associate } = await AppApi.login(
          onlyDigits(identificador),
          password,
        );
        await signInAssociado(
          accessToken,
          associate.name,
          associate.mustChangePassword ?? false,
        );
      } else {
        const { accessToken, user } = await InternalApi.login(
          identificador.trim(),
          password,
        );
        await signInInterno(accessToken, user);
        router.replace('/interno/painel');
      }
    } catch {
      // Mensagem IDÊNTICA nos dois caminhos. Se variasse, o app viraria um
      // verificador de quais e-mails pertencem ao time — e uma lista dessas é
      // o primeiro passo de qualquer ataque dirigido.
      RNAlert.alert(
        'Não foi possível entrar',
        'CPF/e-mail ou senha inválidos. Confira e tente de novo.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <BrandLockup />
          </View>

          <Text style={styles.title}>Acesse sua conta</Text>
          <Text style={styles.subtitle}>
            Acompanhe a localização do seu veículo em tempo real.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>CPF ou e-mail</Text>
            <TextInput
              value={identificador}
              onChangeText={handleChange}
              placeholder="000.000.000-00"
              placeholderTextColor={colors.textFaint}
              keyboardType="default"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              maxLength={80}
              autoComplete="off"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Senha</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Seu CPF"
              placeholderTextColor={colors.textFaint}
              secureTextEntry
              style={styles.input}
            />
          </View>

          <TouchableOpacity
            onPress={handleLogin}
            disabled={!canSubmit || loading}
            activeOpacity={0.85}
            style={[styles.button, (!canSubmit || loading) && styles.buttonOff]}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Entrar</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/forgot-password')}
            style={styles.forgot}
          >
            <Text style={styles.forgotText}>Esqueci minha senha</Text>
          </TouchableOpacity>

          <Text style={styles.help}>
            No primeiro acesso, a senha é o seu próprio CPF. Não consegue
            entrar? Fale com a sua associação.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  header: { marginBottom: 40 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 6,
    marginBottom: 28,
  },
  field: { marginBottom: 16 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  button: {
    backgroundColor: colors.orange,
    borderRadius: radii.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
    shadowColor: colors.orange,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  buttonOff: { backgroundColor: colors.orangeSoft, shadowOpacity: 0 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  forgot: { alignItems: 'center', marginTop: 18 },
  forgotText: { color: colors.navy, fontSize: 14, fontWeight: '600' },
  help: {
    fontSize: 13,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
});
