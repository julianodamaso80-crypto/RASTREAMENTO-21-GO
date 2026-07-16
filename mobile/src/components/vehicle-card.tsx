import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Vehicle } from '@/lib/api';
import { useAddress } from '@/lib/geocode';
import { timeAgo, compass, formatDateTime } from '@/lib/format';
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

/** Célula da grade de telemetria (ícone + valor + rótulo). */
function Cell({ icon, label, value, tint }: { icon: IconName; label: string; value: string; tint?: string }) {
  return (
    <View style={styles.cell}>
      <Ionicons name={icon} size={17} color={tint ?? colors.navy} />
      <Text style={styles.cellValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.cellLabel}>{label}</Text>
    </View>
  );
}

/** Linha de dado cadastral (rótulo: valor). */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

export function VehicleCard({
  vehicle,
  selected,
  ownerName,
  onFocus,
  onHistory,
}: {
  vehicle: Vehicle;
  selected: boolean;
  ownerName?: string | null;
  onFocus: () => void;
  onHistory: () => void;
}) {
  const p = vehicle.position;
  const address = useAddress(p?.latitude, p?.longitude);
  const st = statusOf(vehicle);
  const online = vehicle.connection?.status === 'online';
  const ativo = [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Veículo';
  const lowVolt = p?.voltage != null && p.voltage > 0 && p.voltage < 11.8;

  function openStreetView() {
    if (!p) return;
    const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.latitude},${p.longitude}`;
    Linking.openURL(url).catch(() => {});
  }

  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      {/* Cabeçalho: status + placa + conexão */}
      <TouchableOpacity style={styles.header} onPress={onFocus} activeOpacity={0.85}>
        <View style={[styles.badge, { backgroundColor: st.color }]}>
          <Ionicons name={st.icon} size={16} color={colors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.plate}>{vehicle.plate}</Text>
          <Text style={styles.sub}>{ativo} · {st.label}</Text>
        </View>
        <View style={[styles.conn, { backgroundColor: online ? '#dcfce7' : '#f1f5f9' }]}>
          <View style={[styles.connDot, { backgroundColor: online ? colors.green : colors.textFaint }]} />
          <Text style={[styles.connText, { color: online ? colors.green : colors.textMuted }]}>
            {online ? 'ONLINE' : 'OFFLINE'}
          </Text>
        </View>
      </TouchableOpacity>

      {p ? (
        <>
          {/* Endereço */}
          <View style={styles.addrRow}>
            <Ionicons name="location" size={15} color={colors.orange} />
            <Text style={styles.addr} numberOfLines={2}>
              {address ?? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`}
            </Text>
          </View>

          {/* Telemetria — grade 3x3 como o painel do rastreador */}
          <View style={styles.grid}>
            <Cell icon="wifi" label="GPRS" value={timeAgo(vehicle.connection?.lastUpdate)} />
            <Cell icon="location-outline" label="GPS" value={formatDateTime(p.fixTime)} />
            <Cell icon="compass-outline" label="Direção" value={compass(p.course)} />

            <Cell
              icon="key"
              label="Ignição"
              value={p.ignition === true ? 'Ligada' : p.ignition === false ? 'Desligada' : '—'}
              tint={p.ignition ? colors.green : colors.orange}
            />
            <Cell icon="speedometer-outline" label="Velocidade" value={`${Math.round(p.speed)} km/h`} />
            <Cell
              icon="flash-outline"
              label="Voltagem"
              value={p.voltage != null ? `${p.voltage.toFixed(1)} V` : '—'}
              tint={lowVolt ? colors.red : colors.navy}
            />

            <Cell icon="cellular-outline" label="Satélites" value={p.satellites != null ? String(p.satellites) : '—'} />
            <Cell icon="navigate-circle-outline" label="Latitude" value={p.latitude.toFixed(5)} />
            <Cell icon="navigate-circle-outline" label="Longitude" value={p.longitude.toFixed(5)} />
          </View>

          {/* Dados do veículo */}
          <View style={styles.infoBox}>
            {ownerName ? <InfoRow label="Proprietário" value={ownerName} /> : null}
            <InfoRow label="Ativo" value={ativo} />
            {vehicle.year ? <InfoRow label="Ano" value={String(vehicle.year)} /> : null}
            {vehicle.color ? <InfoRow label="Cor" value={vehicle.color} /> : null}
            <InfoRow label="Placa" value={vehicle.plate} />
          </View>

          {/* Ações */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btn} onPress={onFocus}>
              <Ionicons name="locate" size={16} color={colors.navy} />
              <Text style={styles.btnText}>Centralizar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={onHistory}>
              <Ionicons name="time-outline" size={16} color={colors.navy} />
              <Text style={styles.btnText}>Histórico</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={openStreetView}>
              <Ionicons name="man-outline" size={16} color={colors.navy} />
              <Text style={styles.btnText}>Street View</Text>
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
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  plate: { fontWeight: '800', fontSize: 18, color: colors.text, letterSpacing: 0.5 },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  conn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: radii.pill,
  },
  connDot: { width: 7, height: 7, borderRadius: 4 },
  connText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  addrRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  addr: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18 },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    marginTop: 12,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: 12,
  },
  cell: { width: '33.33%', alignItems: 'center', gap: 3, paddingVertical: 8, paddingHorizontal: 4 },
  cellValue: { fontSize: 13, fontWeight: '800', color: colors.text },
  cellLabel: { fontSize: 10.5, color: colors.textMuted },
  infoBox: {
    marginTop: 12,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  infoLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  infoValue: { fontSize: 13, color: colors.text, fontWeight: '700', flexShrink: 1, marginLeft: 12 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 10, borderRadius: radii.md,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border,
  },
  btnText: { color: colors.navy, fontWeight: '700', fontSize: 12 },
  waiting: {
    marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: colors.border,
    color: colors.textMuted, fontSize: 13,
  },
});
