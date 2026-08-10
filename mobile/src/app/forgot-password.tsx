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
import { AppApi } from '@/lib/api';
import { maskCpf, onlyDigits } from '@/lib/format';
import { colors, radii } from '@/lib/theme';

/**
 * Recuperação de senha em duas etapas: pede o código no WhatsApp cadastrado e,
 * com ele em mãos, o cliente já define a senha nova.
 *
 * O código é de uso único, vale 15 minutos e morre depois de 5 erros — por isso
 * nunca vira "senha temporária" que fica valendo no histórico da conversa.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [etapa, setEtapa] = useState<'cpf' | 'codigo'>('cpf');
  const [cpf, setCpf] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [loading, setLoading] = useState(false);

  const cpfValido = onlyDigits(cpf).length === 11;
  const novaValida = nova.trim().length >= 6;
  const conferem = nova === confirma;
  const naoEhCpf = onlyDigits(nova) !== onlyDigits(cpf) || !onlyDigits(nova);
  const podeSalvar =
    codigo.length === 6 && novaValida && conferem && naoEhCpf && !loading;

  async function pedirCodigo() {
    if (!cpfValido || loading) return;
    setLoading(true);
    try {
      const r = await AppApi.forgotPassword(onlyDigits(cpf));
      setAviso(
        r.sentTo
          ? `Enviamos um código no WhatsApp ${r.sentTo}.`
          : r.message,
      );
      // Avança mesmo sem confirmação de envio: a resposta é propositalmente
      // igual pra CPF que existe e pra CPF que não existe.
      setEtapa('codigo');
    } catch (e: any) {
      RNAlert.alert(
        'Não consegui enviar',
        e?.response?.data?.message ||
          'Tente de novo em instantes ou fale com a sua associação.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function salvarSenha() {
    if (!podeSalvar) return;
    setLoading(true);
    try {
      await AppApi.resetPassword(onlyDigits(cpf), codigo, nova);
      RNAlert.alert(
        'Senha criada',
        'Pronto. Entre com a sua nova senha.',
        [{ text: 'OK', onPress: () => router.replace('/login') }],
      );
    } catch (e: any) {
      RNAlert.alert(
        'Não deu certo',
        e?.response?.data?.message ||
          'Código inválido ou expirado. Peça um novo código.',
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
          <Text style={styles.title}>Esqueci minha senha</Text>

          {etapa === 'cpf' ? (
            <>
              <Text style={styles.subtitle}>
                Digite o seu CPF. Vamos mandar um código no WhatsApp que está
                cadastrado na sua associação.
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
                />
              </View>

              <TouchableOpacity
                onPress={pedirCodigo}
                disabled={!cpfValido || loading}
                activeOpacity={0.85}
                style={[
                  styles.button,
                  (!cpfValido || loading) && styles.buttonOff,
                ]}
              >
                {loading ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.buttonText}>Enviar código</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.subtitle}>
                {aviso ??
                  'Se esse CPF estiver cadastrado, enviamos um código no WhatsApp.'}
              </Text>

              <View style={styles.field}>
                <Text style={styles.label}>Código de 6 números</Text>
                <TextInput
                  value={codigo}
                  onChangeText={(t) => setCodigo(onlyDigits(t).slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor={colors.textFaint}
                  keyboardType="number-pad"
                  style={[styles.input, styles.inputCodigo]}
                  maxLength={6}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Nova senha</Text>
                <TextInput
                  value={nova}
                  onChangeText={setNova}
                  placeholder="Mínimo de 6 caracteres"
                  placeholderTextColor={colors.textFaint}
                  secureTextEntry
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Repita a nova senha</Text>
                <TextInput
                  value={confirma}
                  onChangeText={setConfirma}
                  placeholder="Digite de novo"
                  placeholderTextColor={colors.textFaint}
                  secureTextEntry
                  style={styles.input}
                />
              </View>

              {!!confirma && !conferem && (
                <Text style={styles.erro}>As duas senhas não são iguais.</Text>
              )}
              {novaValida && !naoEhCpf && (
                <Text style={styles.erro}>
                  A nova senha não pode ser o seu CPF.
                </Text>
              )}

              <TouchableOpacity
                onPress={salvarSenha}
                disabled={!podeSalvar}
                activeOpacity={0.85}
                style={[styles.button, !podeSalvar && styles.buttonOff]}
              >
                {loading ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.buttonText}>Salvar nova senha</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setEtapa('cpf');
                  setCodigo('');
                }}
                style={styles.link}
              >
                <Text style={styles.linkText}>Não recebi o código</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            onPress={() => router.replace('/login')}
            style={styles.link}
          >
            <Text style={styles.linkText}>Voltar para o login</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 6,
    marginBottom: 28,
    lineHeight: 21,
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
  inputCodigo: {
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    fontWeight: '700',
  },
  erro: { color: colors.red, fontSize: 13, marginBottom: 8 },
  button: {
    backgroundColor: colors.orange,
    borderRadius: radii.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonOff: { backgroundColor: colors.orangeSoft },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  link: { alignItems: 'center', marginTop: 18 },
  linkText: { color: colors.textFaint, fontSize: 14 },
});
