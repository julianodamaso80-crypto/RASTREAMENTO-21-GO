import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AppApi, Vehicle } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { timeAgo } from '@/lib/format';
import { colors, radii } from '@/lib/theme';

const POLL_MS = 12000;

/** Verde = ligado, vermelho = desligado, cinza = sem posição. */
function statusColor(v: Vehicle): string {
  if (!v.position) return colors.textFaint;
  if (v.position.ignition === true) return colors.green;
  if (v.position.ignition === false) return colors.red;
  return colors.amber;
}

function statusLabel(v: Vehicle): string {
  if (!v.position) return 'Sem sinal';
  if (v.position.ignition === true) return 'Ligado';
  if (v.position.ignition === false) return 'Desligado';
  return 'Em repouso';
}

export default function MapScreen() {
  const router = useRouter();
  const name = useAuth((s) => s.name);
  const mapRef = useRef<MapView>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await AppApi.vehicles();
      setVehicles(data);
    } catch {
      // silencioso no polling; 401 já trata logout no interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const focusVehicle = useCallback((v: Vehicle) => {
    if (!v.position) return;
    setSelected(v.id);
    const region: Region = {
      latitude: v.position.latitude,
      longitude: v.position.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
    mapRef.current?.animateToRegion(region, 600);
  }, []);

  const withPos = vehicles.filter((v) => v.position);
  const initialRegion: Region | undefined = withPos[0]
    ? {
        latitude: withPos[0].position!.latitude,
        longitude: withPos[0].position!.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : undefined;

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
      >
        {withPos.map((v) => (
          <Marker
            key={v.id}
            coordinate={{
              latitude: v.position!.latitude,
              longitude: v.position!.longitude,
            }}
            onPress={() => setSelected(v.id)}
            title={v.plate}
            description={statusLabel(v)}
          >
            <View style={[styles.pin, { backgroundColor: statusColor(v) }]}>
              <Ionicons name="car-sport" size={16} color={colors.white} />
            </View>
          </Marker>
        ))}
      </MapView>

      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        <View style={styles.greeting}>
          <Text style={styles.hello}>Olá{name ? `, ${name.split(' ')[0]}` : ''}</Text>
          <Text style={styles.helloSub}>
            {withPos.length} de {vehicles.length}{' '}
            {vehicles.length === 1 ? 'veículo' : 'veículos'} no mapa
          </Text>
        </View>
      </SafeAreaView>

      <View style={styles.sheet}>
        <View style={styles.handle} />
        {loading ? (
          <ActivityIndicator color={colors.navy} style={{ paddingVertical: 24 }} />
        ) : vehicles.length === 0 ? (
          <Text style={styles.empty}>
            Nenhum veículo vinculado à sua conta ainda.
          </Text>
        ) : (
          <ScrollView
            style={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
          >
            {vehicles.map((v) => (
              <TouchableOpacity
                key={v.id}
                style={[
                  styles.card,
                  selected === v.id && styles.cardSelected,
                ]}
                activeOpacity={0.8}
                onPress={() => focusVehicle(v)}
              >
                <View
                  style={[styles.dot, { backgroundColor: statusColor(v) }]}
                />
                <View style={styles.cardBody}>
                  <Text style={styles.plate}>{v.plate}</Text>
                  <Text style={styles.cardSub}>
                    {[v.brand, v.model].filter(Boolean).join(' ') || 'Veículo'} ·{' '}
                    {statusLabel(v)}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {v.position
                      ? `${v.position.speed} km/h · ${timeAgo(v.position.fixTime)}`
                      : 'Aguardando posição'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => router.push(`/vehicle/${v.id}`)}
                  hitSlop={10}
                  style={styles.histBtn}
                >
                  <Ionicons name="time-outline" size={22} color={colors.navy} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0 },
  greeting: {
    margin: 16,
    backgroundColor: colors.navy,
    borderRadius: radii.lg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignSelf: 'flex-start',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  hello: { color: colors.white, fontWeight: '800', fontSize: 16 },
  helloSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '46%',
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  list: { marginBottom: 4 },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardSelected: { borderColor: colors.orange, backgroundColor: '#fff7ed' },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  cardBody: { flex: 1 },
  plate: { fontWeight: '800', fontSize: 16, color: colors.text },
  cardSub: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  cardMeta: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  histBtn: { padding: 6 },
});
