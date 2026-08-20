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
import { useAuth } from '@/lib/auth-store';
import { onlyDigits } from '@/lib/format';
import { PasswordInput } from '@/components/password-input';
import { colors, radii } from '@/lib/theme';

/**
 * Troca de senha do primeiro acesso.
 *
 * O cliente entra com CPF/CPF e cai aqui obrigatoriamente. Enquanto ele não
 * define uma senha própria, o CPF continua valendo como senha — e CPF é dado
 * semi-público no Brasil, então qualquer um que soubesse o do cliente veria a
 * localização do carro dele em tempo real.
 */
export default function ChangePasswordScreen() {
  const router = useRouter();
  const cpfDoLogin = useAuth((s) => s.name); // só pra exibição amigável
  const setMustChangePassword = useAuth((s) => s.setMustChangePassword);
  const logout = useAuth((s) => s.logout);
  // Primeiro acesso (obrigatório) x troca voluntária pelo perfil.
  const obrigatoria = useAuth((s) => s.mustChangePassword);

  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [loading, setLoading] = useState(false);

  const novaValida = nova.trim().length >= 6;
  const conferem = nova === confirma;
  const naoEhCpf = onlyDigits(nova) !== onlyDigits(atual) || !onlyDigits(nova);
  const canSubmit =
    atual.length >= 6 && novaValida && conferem && naoEhCpf && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await AppApi.changePassword(atual, nova);
      const eraObrigatoria = obrigatoria;
      await setMustChangePassword(false);
      RNAlert.alert(
        eraObrigatoria ? 'Senha criada' : 'Senha alterada',
        'Pronto. Use essa senha nos próximos acessos.',
      );
      // No primeiro acesso o gate do _layout libera o app sozinho; na troca
      // voluntária (pelo perfil) voltamos pra tela de onde o usuário veio.
      if (!eraObrigatoria && router.canGoBack()) router.back();
    } catch (e: any) {
      const msg =
        e?.response?.data?.message ||
        'Não consegui trocar a senha. Confira a senha atual e tente de novo.';
      RNAlert.alert('Não foi possível trocar a senha', msg);
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
          <Text style={styles.title}>
            {obrigatoria ? 'Crie a sua senha' : 'Trocar minha senha'}
          </Text>
          <Text style={styles.subtitle}>
            {obrigatoria
              ? `${cpfDoLogin ? `${cpfDoLogin}, este` : 'Este'} é o seu primeiro acesso. Escolha uma senha só sua — assim ninguém entra na sua conta sabendo apenas o seu CPF.`
              : 'Escolha uma nova senha para a sua conta.'}
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>
              {obrigatoria ? 'Senha atual (o seu CPF)' : 'Senha atual'}
            </Text>
            <PasswordInput
              value={atual}
              onChangeText={setAtual}
              placeholder={obrigatoria ? 'Digite o seu CPF' : 'Sua senha atual'}
              inputStyle={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Nova senha</Text>
            <PasswordInput
              value={nova}
              onChangeText={setNova}
              placeholder="Mínimo de 6 caracteres"
              inputStyle={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Repita a nova senha</Text>
            <PasswordInput
              value={confirma}
              onChangeText={setConfirma}
              placeholder="Digite de novo"
              inputStyle={styles.input}
            />
          </View>

          {!!confirma && !conferem && (
            <Text style={styles.erro}>As duas senhas não são iguais.</Text>
          )}
          {novaValida && !naoEhCpf && (
            <Text style={styles.erro}>A nova senha não pode ser o seu CPF.</Text>
          )}

          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!canSubmit}
            activeOpacity={0.85}
            style={[styles.button, !canSubmit && styles.buttonOff]}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Salvar minha senha</Text>
            )}
          </TouchableOpacity>

          {/* No primeiro acesso não há pra onde voltar: a única saída é sair
              da conta. Na troca voluntária, cancelar volta pro perfil. */}
          <TouchableOpacity
            onPress={() => {
              if (obrigatoria) logout();
              else if (router.canGoBack()) router.back();
            }}
            style={styles.sair}
          >
            <Text style={styles.sairText}>
              {obrigatoria ? 'Sair' : 'Cancelar'}
            </Text>
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
  sair: { alignItems: 'center', marginTop: 20 },
  sairText: { color: colors.textFaint, fontSize: 14 },
});
