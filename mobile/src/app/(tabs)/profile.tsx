import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert as RNAlert,
  Linking,
  ScrollView,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppApi, AssociateProfile, NotificationPrefs } from '@/lib/api';
import { garantirPermissaoPush } from '@/lib/push';
import { useAuth } from '@/lib/auth-store';
import { maskDocumento } from '@/lib/format';
import { colors, radii } from '@/lib/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const logout = useAuth((s) => s.logout);
  const [profile, setProfile] = useState<AssociateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  useEffect(() => {
    AppApi.me()
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoading(false));
    AppApi.notificacoes()
      .then(setPrefs)
      .catch(() => {});
  }, []);

  async function alternar(campo: keyof NotificationPrefs, valor: boolean) {
    if (!prefs) return;
    const anterior = prefs;
    setPrefs({ ...prefs, [campo]: valor });
    try {
      setPrefs(await AppApi.setNotificacoes({ [campo]: valor }));
    } catch {
      setPrefs(anterior);
      RNAlert.alert('Não foi possível salvar', 'Verifique sua internet e tente de novo.');
      return;
    }
    if (valor && !(await garantirPermissaoPush())) {
      RNAlert.alert(
        'Notificações bloqueadas',
        'O aviso foi ligado, mas as notificações do 21 Tracker estão bloqueadas neste celular. Libere nas configurações para recebê-lo.',
        [
          { text: 'Agora não', style: 'cancel' },
          { text: 'Abrir configurações', onPress: () => Linking.openSettings() },
        ],
      );
    }
  }

  function confirmLogout() {
    RNAlert.alert('Sair', 'Deseja sair da sua conta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => logout() },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Perfil</Text>

        {loading ? (
          <ActivityIndicator color={colors.navy} style={{ marginTop: 40 }} />
        ) : profile ? (
          <View style={styles.content}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{profile.name.charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={styles.name}>{profile.name}</Text>
              <Text style={styles.tenant}>{profile.tenant?.name}</Text>
            </View>

            <View style={styles.rows}>
              <Row
                icon="card-outline"
                label={profile.cpf.replace(/\D/g, '').length > 11 ? 'CNPJ' : 'CPF'}
                value={maskDocumento(profile.cpf)}
              />
              {profile.email ? (
                <Row icon="mail-outline" label="E-mail" value={profile.email} />
              ) : null}
              {profile.phone ? (
                <Row icon="call-outline" label="Telefone" value={profile.phone} />
              ) : null}
              <Row
                icon="car-outline"
                label="Veículos"
                value={String(profile._count?.vehicles ?? 0)}
              />
            </View>
          </View>
        ) : (
          <Text style={styles.error}>Não foi possível carregar o perfil.</Text>
        )}

        {prefs ? (
          <View style={styles.content}>
            <Text style={styles.section}>Notificações</Text>
            <View style={styles.rows}>
              <SwitchRow
                icon="key-outline"
                label="Chave ligada"
                value={prefs.ignicaoLigada}
                onChange={(v) => alternar('ignicaoLigada', v)}
              />
              <SwitchRow
                icon="power-outline"
                label="Chave desligada"
                value={prefs.ignicaoDesligada}
                onChange={(v) => alternar('ignicaoDesligada', v)}
              />
            </View>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.action}
          onPress={() => router.push('/change-password')}
          activeOpacity={0.8}
        >
          <Ionicons name="key-outline" size={20} color={colors.navy} />
          <Text style={styles.actionText}>Trocar minha senha</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logout} onPress={confirmLogout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={20} color={colors.red} />
          <Text style={styles.logoutText}>Sair da conta</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={colors.textMuted} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function SwitchRow({
  icon,
  label,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={colors.textMuted} />
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.navy, false: colors.border }}
        thumbColor={colors.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 8,
  },
  switchLabel: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  content: { paddingHorizontal: 20, marginTop: 12 },
  avatarWrap: { alignItems: 'center', marginVertical: 20 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.white, fontSize: 34, fontWeight: '800' },
  name: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 12 },
  tenant: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  rows: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  rowLabel: { fontSize: 15, color: colors.textMuted, flex: 1 },
  rowValue: { fontSize: 15, fontWeight: '600', color: colors.text },
  error: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 'auto',
    marginBottom: 12,
    marginHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: { color: colors.navy, fontSize: 16, fontWeight: '700' },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
    marginHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logoutText: { color: colors.red, fontSize: 16, fontWeight: '700' },
});
