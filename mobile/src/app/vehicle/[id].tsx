import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SatelliteTiles } from '@/components/satellite-tiles';
import { AppApi, Position, VehicleType } from '@/lib/api';
import { markerSource, vehicleTypeLabel } from '@/lib/vehicle-visual';
import { useAddress } from '@/lib/geocode';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  distanceMeters,
} from '@/lib/format';
import { colors, radii } from '@/lib/theme';

const RANGES = [
  { label: 'Hoje', hours: 24 },
  { label: '3 dias', hours: 72 },
  { label: '7 dias', hours: 168 },
];

export default function VehicleHistoryScreen() {
  const { id, plate, type } = useLocalSearchParams<{
    id: string;
    plate?: string;
    type?: VehicleType;
  }>();
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

  // Distância total percorrida somando trecho a trecho.
  const totalMeters = useMemo(() => {
    let sum = 0;
    for (let i = 1; i < positions.length; i++) {
      sum += distanceMeters(
        positions[i - 1].latitude,
        positions[i - 1].longitude,
        positions[i].latitude,
        positions[i].longitude,
      );
    }
    return sum;
  }, [positions]);

  // Nome de rua de início e fim (geocoding reverso client-side).
  const startAddress = useAddress(start?.latitude, start?.longitude);
  const endAddress = useAddress(end?.latitude, end?.longitude);

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{ title: plate ? String(plate) : 'Histórico' }}
      />

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
                anchor={{ x: 0.5, y: 0.5 }}
                title="Início"
                description={startAddress ?? formatDateTime(start.fixTime)}
              >
                <View style={[styles.flag, { backgroundColor: colors.green }]}>
                  <Ionicons name="flag" size={13} color={colors.white} />
                </View>
              </Marker>
            )}
            {end && (
              <Marker
                coordinate={{ latitude: end.latitude, longitude: end.longitude }}
                anchor={{ x: 0.5, y: 0.5 }}
                title="Posição atual"
                description={endAddress ?? formatDateTime(end.fixTime)}
              >
                <View style={styles.endWrap}>
                  <View style={[styles.ring, { borderColor: colors.navy }]} />
                  <Image
                    source={markerSource(type)}
                    style={[
                      styles.endImg,
                      { transform: [{ rotate: `${end.course ?? 0}deg` }] },
                    ]}
                    resizeMode="contain"
                  />
                </View>
              </Marker>
            )}
          </MapView>
        )}
      </View>

      {!loading && coords.length > 0 && (
        <ScrollView
          style={styles.panel}
          contentContainerStyle={{ paddingBottom: 16 }}
        >
          <View style={styles.stats}>
            <Stat label="Distância" value={formatDistance(totalMeters)} />
            <Stat label="Duração" value={formatDuration(start?.fixTime, end?.fixTime)} />
            <Stat label="Vel. máx" value={`${Math.round(maxSpeed)} km/h`} />
            <Stat label="Pontos" value={String(positions.length)} />
          </View>

          <AddressRow
            icon="flag"
            tint={colors.green}
            label="Saída"
            address={startAddress}
            fallback={start}
          />
          <AddressRow
            icon="location"
            tint={colors.navy}
            label={`Chegada${type ? ` · ${vehicleTypeLabel(type)}` : ''}`}
            address={endAddress}
            fallback={end}
          />
        </ScrollView>
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

function AddressRow({
  icon,
  tint,
  label,
  address,
  fallback,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  label: string;
  address: string | null;
  fallback?: Position;
}) {
  const text =
    address ??
    (fallback
      ? `${fallback.latitude.toFixed(5)}, ${fallback.longitude.toFixed(5)}`
      : '—');
  return (
    <View style={styles.addrRow}>
      <View style={[styles.addrIcon, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={14} color={colors.white} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.addrLabel}>{label}</Text>
        <Text style={styles.addrText}>{text}</Text>
        {fallback && (
          <Text style={styles.addrTime}>{formatDateTime(fallback.fixTime)}</Text>
        )}
      </View>
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
  flag: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
  },
  endWrap: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    backgroundColor: 'rgba(15,23,42,0.25)',
  },
  endImg: { width: 36, height: 36 },
  panel: {
    maxHeight: '42%',
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  stats: {
    flexDirection: 'row',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 15, fontWeight: '800', color: colors.navy },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  addrIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  addrLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '700' },
  addrText: { fontSize: 14, color: colors.text, marginTop: 1, lineHeight: 19 },
  addrTime: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
});
