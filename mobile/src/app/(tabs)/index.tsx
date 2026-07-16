import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Region } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { SatelliteTiles } from '@/components/satellite-tiles';
import { VehicleCard } from '@/components/vehicle-card';
import { VehicleMarker } from '@/components/vehicle-marker';
import { AppApi, Vehicle, Position } from '@/lib/api';
import { useVehicleRealtime, RawTraccarDevice } from '@/lib/realtime';
import { useAuth } from '@/lib/auth-store';
import { colors, radii } from '@/lib/theme';

const POLL_MS = 20000;

const SCREEN_H = Dimensions.get('window').height;
const SHEET_MAX = Math.round(SCREEN_H * 0.66);
const SHEET_MIN = 150;

/** Cor do ponto de status derivada da POSIÇÃO GPS real. */
function dotColor(v: Vehicle): string {
  const p = v.position;
  if (!p) return colors.textFaint;
  if (p.motion) return colors.green;
  if (p.ignition === false) return colors.red;
  return colors.amber;
}

export default function MapScreen() {
  const router = useRouter();
  const name = useAuth((s) => s.name);
  const mapRef = useRef<MapView>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const sheetH = useRef(new Animated.Value(SHEET_MAX)).current;
  const startH = useRef(SHEET_MAX);
  const snapTo = useCallback(
    (to: number) => {
      Animated.spring(sheetH, { toValue: to, useNativeDriver: false, bounciness: 2, speed: 14 }).start();
    },
    [sheetH],
  );
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        sheetH.stopAnimation((v: number) => {
          startH.current = v;
        });
      },
      onPanResponderMove: (_, g) => {
        const h = Math.min(SHEET_MAX, Math.max(SHEET_MIN, startH.current - g.dy));
        sheetH.setValue(h);
      },
      onPanResponderRelease: (_, g) => {
        const current = Math.min(SHEET_MAX, Math.max(SHEET_MIN, startH.current - g.dy));
        const mid = (SHEET_MAX + SHEET_MIN) / 2;
        const target =
          g.vy > 0.5 ? SHEET_MIN : g.vy < -0.5 ? SHEET_MAX : current < mid ? SHEET_MIN : SHEET_MAX;
        Animated.spring(sheetH, { toValue: target, useNativeDriver: false, bounciness: 2, speed: 14 }).start();
      },
    }),
  ).current;

  const load = useCallback(async () => {
    try {
      const data = await AppApi.vehicles();
      setVehicles(data);
    } catch {
      // silencioso; 401 já trata logout no interceptor
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

  const onPosition = useCallback((deviceId: number, position: Position) => {
    setVehicles((prev) =>
      prev.map((v) => (v.traccarDeviceId === deviceId ? { ...v, position } : v)),
    );
  }, []);

  const onDevice = useCallback((device: RawTraccarDevice) => {
    setVehicles((prev) =>
      prev.map((v) =>
        v.traccarDeviceId === device.id
          ? { ...v, connection: { status: device.status, lastUpdate: device.lastUpdate } }
          : v,
      ),
    );
  }, []);

  const { connected } = useVehicleRealtime({ onPosition, onDevice });

  const centerOn = useCallback((v: Vehicle) => {
    if (!v.position) return;
    mapRef.current?.animateToRegion(
      {
        latitude: v.position.latitude,
        longitude: v.position.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
      600,
    );
  }, []);

  // Trocar de veículo pela aba: seleciona + centraliza (mantém o painel aberto).
  const pickVehicle = useCallback(
    (v: Vehicle) => {
      setSelected(v.id);
      centerOn(v);
    },
    [centerOn],
  );

  // Botão "Centralizar" do card: foca e minimiza o painel pra ver o mapa.
  const focusVehicle = useCallback(
    (v: Vehicle) => {
      setSelected(v.id);
      centerOn(v);
      snapTo(SHEET_MIN);
    },
    [centerOn, snapTo],
  );

  const withPos = vehicles.filter((v) => v.position);
  const initialRegion: Region | undefined = withPos[0]
    ? {
        latitude: withPos[0].position!.latitude,
        longitude: withPos[0].position!.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : undefined;

  // Veículo em foco: o selecionado, ou o primeiro por padrão.
  const currentId = selected ?? vehicles[0]?.id ?? null;
  const current = vehicles.find((v) => v.id === currentId) ?? null;

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        mapType="standard"
        showsUserLocation={false}
        showsMyLocationButton={false}
      >
        <SatelliteTiles />
        {withPos.map((v) => (
          <VehicleMarker key={v.id} vehicle={v} onPress={() => pickVehicle(v)} />
        ))}
      </MapView>

      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        <View style={styles.greeting}>
          <View style={styles.helloRow}>
            <Text style={styles.hello}>Olá{name ? `, ${name.split(' ')[0]}` : ''}</Text>
            <View style={styles.liveTag}>
              <View style={[styles.liveDot, { backgroundColor: connected ? colors.green : colors.textFaint }]} />
              <Text style={styles.liveText}>{connected ? 'AO VIVO' : '···'}</Text>
            </View>
          </View>
          <Text style={styles.helloSub}>
            {withPos.length} de {vehicles.length} {vehicles.length === 1 ? 'veículo' : 'veículos'} no mapa
          </Text>
        </View>
      </SafeAreaView>

      <Animated.View style={[styles.sheet, { height: sheetH }]}>
        <View style={styles.grabZone} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        {/* Abas de placa — só aparecem com mais de um veículo */}
        {vehicles.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabs}
            contentContainerStyle={styles.tabsContent}
          >
            {vehicles.map((v) => {
              const active = v.id === currentId;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => pickVehicle(v)}
                  activeOpacity={0.85}
                >
                  <View style={[styles.tabDot, { backgroundColor: dotColor(v) }]} />
                  <Ionicons
                    name={v.vehicleType === 'MOTORCYCLE' ? 'bicycle' : 'car'}
                    size={14}
                    color={active ? colors.white : colors.navy}
                  />
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{v.plate}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        {loading ? (
          <ActivityIndicator color={colors.navy} style={{ paddingVertical: 24 }} />
        ) : vehicles.length === 0 ? (
          <Text style={styles.empty}>Nenhum veículo vinculado à sua conta ainda.</Text>
        ) : current ? (
          <ScrollView
            style={styles.list}
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <VehicleCard
              vehicle={current}
              selected
              ownerName={name}
              onFocus={() => focusVehicle(current)}
              onHistory={() =>
                router.push({
                  pathname: '/vehicle/[id]',
                  params: { id: current.id, plate: current.plate, type: current.vehicleType },
                })
              }
            />
          </ScrollView>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
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
  helloRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hello: { color: colors.white, fontWeight: '800', fontSize: 16 },
  helloSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: { color: colors.white, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
  },
  grabZone: { alignItems: 'center', paddingTop: 8, paddingBottom: 8 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border },
  tabs: { flexGrow: 0, marginBottom: 10 },
  tabsContent: { gap: 8, paddingRight: 8 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabDot: { width: 8, height: 8, borderRadius: 4 },
  tabText: { fontSize: 13, fontWeight: '800', color: colors.navy, letterSpacing: 0.3 },
  tabTextActive: { color: colors.white },
  list: { marginBottom: 0 },
  empty: { textAlign: 'center', color: colors.textMuted, paddingVertical: 28, paddingHorizontal: 20 },
});
