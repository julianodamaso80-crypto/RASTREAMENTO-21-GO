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
import { BrandLockup } from '@/components/brand-logo';
import { AppApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { maskCpf, onlyDigits } from '@/lib/format';
import { colors, radii } from '@/lib/theme';
import { diag } from '@/lib/diag';

export default function LoginScreen() {
  diag('05-login-render');
  const signIn = useAuth((s) => s.signIn);
  const [cpf, setCpf] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = onlyDigits(cpf).length === 11 && password.length >= 6;

  async function handleLogin() {
    if (!canSubmit || loading) return;
    setLoading(true);
    try {
      const { accessToken, associate } = await AppApi.login(
        onlyDigits(cpf),
        password,
      );
      await signIn(accessToken, associate.name);
      // o gate no _layout redireciona pro app
    } catch (e: any) {
      const msg =
        e?.response?.data?.message || 'CPF ou senha inválidos. Tente de novo.';
      RNAlert.alert('Não foi possível entrar', msg);
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
            <Text style={styles.label}>CPF</Text>
            <TextInput
              value={cpf}
              onChangeText={(t) => setCpf(maskCpf(t))}
              placeholder="000.000.000-00"
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad"
              style={styles.input}
              maxLength={14}
              autoComplete="off"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Senha</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Sua senha"
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

          <Text style={styles.help}>
            Não tem senha? Fale com a sua associação para liberar o acesso.
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
  help: {
    fontSize: 13,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
});
