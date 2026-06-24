import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert as RNAlert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppApi, AssociateProfile } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { maskCpf } from '@/lib/format';
import { colors, radii } from '@/lib/theme';

export default function ProfileScreen() {
  const logout = useAuth((s) => s.logout);
  const [profile, setProfile] = useState<AssociateProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AppApi.me()
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function confirmLogout() {
    RNAlert.alert('Sair', 'Deseja sair da sua conta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => logout() },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Perfil</Text>

      {loading ? (
        <ActivityIndicator color={colors.navy} style={{ marginTop: 40 }} />
      ) : profile ? (
        <View style={styles.content}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {profile.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.name}>{profile.name}</Text>
            <Text style={styles.tenant}>{profile.tenant?.name}</Text>
          </View>

          <View style={styles.rows}>
            <Row icon="card-outline" label="CPF" value={maskCpf(profile.cpf)} />
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

      <TouchableOpacity style={styles.logout} onPress={confirmLogout} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={20} color={colors.red} />
        <Text style={styles.logoutText}>Sair da conta</Text>
      </TouchableOpacity>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 'auto',
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
