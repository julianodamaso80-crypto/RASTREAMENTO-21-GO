import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Vehicle } from '@/lib/api';
import { useAddress } from '@/lib/geocode';
import { timeAgo, compass } from '@/lib/format';
import { colors, radii } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** Status derivado da POSIÇÃO GPS real (nunca do heartbeat de conexão). */
function statusOf(v: Vehicle): { color: string; label: string; icon: IconName } {
  const p = v.position;
  if (!p) return { color: colors.textFaint, label: 'Sem sinal', icon: 'help-circle' };
  if (p.motion) return { color: colors.green, label: 'Em movimento', icon: 'navigate' };
  if (p.ignition === true) return { color: colors.amber, label: 'Ligado · parado', icon: 'flash' };
  if (p.ignition === false) return { color: colors.red, label: 'Desligado', icon: 'power' };
  return { color: colors.amber, label: 'Em repouso', icon: 'moon' };
}

function batteryIcon(pct: number | null): IconName {
  if (pct == null) return 'battery-dead';
  if (pct >= 66) return 'battery-full';
  if (pct >= 33) return 'battery-half';
  return 'battery-dead';
}

function Metric({
  icon,
  label,
  value,
  tint,
}: {
  icon: IconName;
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <View style={styles.metric}>
      <Ionicons name={icon} size={16} color={tint ?? colors.navy} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export function VehicleCard({
  vehicle,
  selected,
  onFocus,
  onHistory,
}: {
  vehicle: Vehicle;
  selected: boolean;
  onFocus: () => void;
  onHistory: () => void;
}) {
  const p = vehicle.position;
  const address = useAddress(p?.latitude, p?.longitude);
  const st = statusOf(vehicle);
  const lowBattery = p?.battery != null && p.battery <= 20;

  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      <TouchableOpacity
        style={styles.header}
        onPress={onFocus}
        activeOpacity={0.85}
      >
        <View style={[styles.badge, { backgroundColor: st.color }]}>
          <Ionicons name={st.icon} size={15} color={colors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.plate}>{vehicle.plate}</Text>
          <Text style={styles.sub}>
            {[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Veículo'}
            {' · '}
            {st.label}
          </Text>
        </View>
      </TouchableOpacity>

      {p ? (
        <>
          <View style={styles.addrRow}>
            <Ionicons name="location" size={15} color={colors.orange} />
            <Text style={styles.addr} numberOfLines={2}>
              {address ??
                `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`}
            </Text>
          </View>

          <View style={styles.grid}>
            <Metric
              icon="speedometer"
              label="Velocidade"
              value={`${Math.round(p.speed)} km/h`}
            />
            <Metric icon="compass" label="Direção" value={compass(p.course)} />
            <Metric
              icon={batteryIcon(p.battery)}
              label="Bateria"
              value={p.battery != null ? `${p.battery}%` : '—'}
              tint={lowBattery ? colors.red : colors.navy}
            />
            <Metric icon="time" label="Atualizado" value={timeAgo(p.fixTime)} />
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.btn} onPress={onFocus}>
              <Ionicons name="locate" size={16} color={colors.navy} />
              <Text style={styles.btnText}>Centralizar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={onHistory}>
              <Ionicons name="time-outline" size={16} color={colors.navy} />
              <Text style={styles.btnText}>Histórico</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <Text style={styles.waiting}>Aguardando primeira posição do rastreador…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg,
    borderRadius: radii.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardSelected: { borderColor: colors.orange, backgroundColor: '#fff7ed' },
  header: { flexDirection: 'row', alignItems: 'center' },
  badge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  plate: { fontWeight: '800', fontSize: 17, color: colors.text, letterSpacing: 0.5 },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addr: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18 },
  grid: {
    flexDirection: 'row',
    marginTop: 14,
  },
  metric: { flex: 1, alignItems: 'center', gap: 3 },
  metricValue: { fontSize: 14, fontWeight: '800', color: colors.text },
  metricLabel: { fontSize: 11, color: colors.textMuted },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnText: { color: colors.navy, fontWeight: '700', fontSize: 13 },
  waiting: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    color: colors.textMuted,
    fontSize: 13,
  },
});
