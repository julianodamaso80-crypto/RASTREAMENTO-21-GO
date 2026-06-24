import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppApi, Alert } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { colors, radii } from '@/lib/theme';

const SEVERITY: Record<string, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  CRITICAL: { color: colors.red, icon: 'alert-circle' },
  WARNING: { color: colors.amber, icon: 'warning' },
  INFO: { color: colors.navy, icon: 'information-circle' },
};

export default function AlertsScreen() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setAlerts(await AppApi.alerts(50));
    } catch {
      // interceptor trata 401
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.navy} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Alertas</Text>
      <FlatList
        data={alerts}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.green} />
            <Text style={styles.empty}>Nenhum alerta. Tudo tranquilo!</Text>
          </View>
        }
        renderItem={({ item }) => {
          const sev = SEVERITY[item.severity] ?? SEVERITY.INFO;
          return (
            <View style={styles.card}>
              <View style={[styles.iconWrap, { backgroundColor: sev.color + '22' }]}>
                <Ionicons name={sev.icon} size={22} color={sev.color} />
              </View>
              <View style={styles.body}>
                <Text style={styles.message}>{item.message}</Text>
                <Text style={styles.meta}>
                  {item.vehicle?.plate ? `${item.vehicle.plate} · ` : ''}
                  {formatDateTime(item.createdAt)}
                </Text>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: radii.md,
    padding: 14,
    marginBottom: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  body: { flex: 1 },
  message: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  empty: { color: colors.textMuted, marginTop: 12, fontSize: 15 },
});
