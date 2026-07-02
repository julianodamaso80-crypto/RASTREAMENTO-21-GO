import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SatelliteTiles } from '@/components/satellite-tiles';
import { AppApi, Position } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { colors, radii } from '@/lib/theme';

const RANGES = [
  { label: 'Hoje', hours: 24 },
  { label: '3 dias', hours: 72 },
  { label: '7 dias', hours: 168 },
];

export default function VehicleHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [hours, setHours] = useState(24);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600_000);
    AppApi.history(id, from.toISOString(), to.toISOString())
      .then(setPositions)
      .catch(() => setPositions([]))
      .finally(() => setLoading(false));
  }, [id, hours]);

  const coords = useMemo(
    () => positions.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
    [positions],
  );

  const region: Region | undefined = coords[0]
    ? {
        latitude: coords[0].latitude,
        longitude: coords[0].longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : undefined;

  const start = positions[0];
  const end = positions[positions.length - 1];
  const maxSpeed = positions.reduce((m, p) => Math.max(m, p.speed), 0);

  return (
    <View style={styles.root}>
      <View style={styles.ranges}>
        {RANGES.map((r) => (
          <TouchableOpacity
            key={r.hours}
            onPress={() => setHours(r.hours)}
            style={[styles.chip, hours === r.hours && styles.chipOn]}
          >
            <Text style={[styles.chipText, hours === r.hours && styles.chipTextOn]}>
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.mapWrap}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.navy} size="large" />
          </View>
        ) : coords.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="trail-sign-outline" size={42} color={colors.textFaint} />
            <Text style={styles.empty}>Sem trajeto registrado nesse período.</Text>
          </View>
        ) : (
          <MapView style={StyleSheet.absoluteFill} initialRegion={region} mapType="standard">
            <SatelliteTiles />
            <Polyline
              coordinates={coords}
              strokeColor={colors.orange}
              strokeWidth={4}
            />
            {start && (
              <Marker
                coordinate={{ latitude: start.latitude, longitude: start.longitude }}
                title="Início"
                description={formatDateTime(start.fixTime)}
                pinColor={colors.green}
              />
            )}
            {end && (
              <Marker
                coordinate={{ latitude: end.latitude, longitude: end.longitude }}
                title="Fim"
                description={formatDateTime(end.fixTime)}
                pinColor={colors.red}
              />
            )}
          </MapView>
        )}
      </View>

      {!loading && coords.length > 0 && (
        <View style={styles.stats}>
          <Stat label="Pontos" value={String(positions.length)} />
          <Stat label="Vel. máx" value={`${maxSpeed} km/h`} />
          <Stat label="Início" value={formatDateTime(start?.fixTime)} />
        </View>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  ranges: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    backgroundColor: colors.white,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: colors.white },
  mapWrap: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  empty: { color: colors.textMuted, marginTop: 10, textAlign: 'center' },
  stats: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '800', color: colors.navy },
  statLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
