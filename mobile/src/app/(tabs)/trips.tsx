import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AppApi, Trip, Vehicle } from '@/lib/api';
import { useAddress } from '@/lib/geocode';
import { colors, radii } from '@/lib/theme';

const RANGES = [
  { label: 'Hoje', hours: 24 },
  { label: '3 dias', hours: 72 },
  { label: '7 dias', hours: 168 },
];

/** "Hoje", "Ontem" ou "quarta, 26/08" — como a pessoa fala, não como a máquina. */
function tituloDoDia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mesmoDia(d, hoje)) return 'Hoje';
  const ontem = new Date(hoje.getTime() - 86400_000);
  if (mesmoDia(d, ontem)) return 'Ontem';
  const semana = d.toLocaleDateString('pt-BR', { weekday: 'long' });
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${semana}, ${data}`;
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function km(valor: number): string {
  return `${valor.toFixed(1).replace('.', ',')} km`;
}

function duracao(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export default function TripsScreen() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    AppApi.vehicles()
      .then((list) => {
        setVehicles(list);
        setVehicleId((atual) => atual ?? list[0]?.id ?? null);
      })
      .catch(() => setVehicles([]));
  }, []);

  const carregar = useCallback(async () => {
    if (!vehicleId) return;
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600_000);
    try {
      setTrips(await AppApi.trips(vehicleId, from.toISOString(), to.toISOString()));
    } catch {
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, [vehicleId, hours]);

  useEffect(() => {
    setLoading(true);
    carregar();
  }, [carregar]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await carregar();
    setRefreshing(false);
  }, [carregar]);

  const veiculo = vehicles.find((v) => v.id === vehicleId) ?? null;

  // Um bloco por dia, com o total do dia no cabeçalho.
  const secoes = useMemo(() => {
    const porDia = new Map<string, Trip[]>();
    for (const t of trips) {
      const dia = new Date(t.startTime).toDateString();
      const lista = porDia.get(dia);
      if (lista) lista.push(t);
      else porDia.set(dia, [t]);
    }
    return [...porDia.entries()].map(([, lista]) => ({
      title: tituloDoDia(lista[0].startTime),
      total: lista.reduce((s, t) => s + t.distanceKm, 0),
      data: lista,
    }));
  }, [trips]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Trajetos</Text>

      {vehicles.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.plates}
          contentContainerStyle={styles.platesContent}
        >
          {vehicles.map((v) => {
            const ativo = v.id === vehicleId;
            return (
              <TouchableOpacity
                key={v.id}
                onPress={() => setVehicleId(v.id)}
                style={[styles.chip, ativo && styles.chipOn]}
              >
                <Ionicons
                  name={v.vehicleType === 'MOTORCYCLE' ? 'bicycle' : 'car'}
                  size={14}
                  color={ativo ? colors.white : colors.navy}
                />
                <Text style={[styles.chipText, ativo && styles.chipTextOn]}>{v.plate}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

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

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.navy} size="large" />
        </View>
      ) : (
        <SectionList
          sections={secoes}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={<SemTrajeto veiculo={veiculo} horas={hours} />}
          renderSectionHeader={({ section }) => (
            <View style={styles.dayHeader}>
              <Text style={styles.dayTitle}>{section.title}</Text>
              <Text style={styles.daySub}>
                {section.data.length} {section.data.length === 1 ? 'trajeto' : 'trajetos'} ·{' '}
                {km(section.total)}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TripCard
              trip={item}
              onPress={() =>
                veiculo &&
                router.push({
                  pathname: '/vehicle/[id]',
                  params: {
                    id: veiculo.id,
                    plate: veiculo.plate,
                    type: veiculo.vehicleType,
                    from: item.startTime,
                    to: item.endTime,
                  },
                })
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function TripCard({ trip, onPress }: { trip: Trip; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.timeline}>
        <View style={[styles.dot, { backgroundColor: colors.green }]} />
        <View style={styles.line} />
        <View style={[styles.dot, { backgroundColor: colors.navy }]} />
      </View>

      <View style={{ flex: 1 }}>
        <View style={styles.leg}>
          <Text style={styles.legTime}>{hora(trip.startTime)}</Text>
          <Text style={styles.legAddress} numberOfLines={2}>
            {trip.startAddress ??
              `${trip.startLat.toFixed(5)}, ${trip.startLng.toFixed(5)}`}
          </Text>
        </View>

        <View style={[styles.leg, { marginTop: 14 }]}>
          <Text style={styles.legTime}>{hora(trip.endTime)}</Text>
          <Text style={styles.legAddress} numberOfLines={2}>
            {trip.endAddress ?? `${trip.endLat.toFixed(5)}, ${trip.endLng.toFixed(5)}`}
          </Text>
        </View>

        <View style={styles.footer}>
          <Badge icon="navigate" text={km(trip.distanceKm)} />
          <Badge icon="time-outline" text={duracao(trip.durationMin)} />
          <Badge icon="speedometer-outline" text={`${trip.maxSpeed} km/h`} />
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function Badge({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.badge}>
      <Ionicons name={icon} size={13} color={colors.navy} />
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  );
}

/**
 * Sem trajeto não é tela vazia: é informação. Diz onde o carro está parado e
 * desde quando — pelo horário do GPS, nunca pelo respiro do rastreador.
 */
function SemTrajeto({ veiculo, horas }: { veiculo: Vehicle | null; horas: number }) {
  const p = veiculo?.position ?? null;
  const endereco = useAddress(p?.latitude, p?.longitude);
  const desde = p
    ? new Date(p.fixTime).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const periodo = horas === 24 ? 'hoje' : `nos últimos ${Math.round(horas / 24)} dias`;

  return (
    <View style={styles.center}>
      <Ionicons name="home-outline" size={44} color={colors.textFaint} />
      <Text style={styles.emptyTitle}>Sem trajeto {periodo}</Text>
      {desde ? (
        <>
          <Text style={styles.emptyText}>Parado desde {desde}</Text>
          {endereco ? <Text style={styles.emptyAddress}>{endereco}</Text> : null}
        </>
      ) : (
        <Text style={styles.emptyText}>
          Ainda não recebemos posição de GPS desse veículo.
        </Text>
      )}
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
    paddingBottom: 12,
  },
  plates: { flexGrow: 0, marginBottom: 4 },
  platesContent: { gap: 8, paddingHorizontal: 16 },
  ranges: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
  chipTextOn: { color: colors.white },
  listContent: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  dayHeader: { paddingTop: 16, paddingBottom: 8 },
  dayTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    textTransform: 'capitalize',
  },
  daySub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  card: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timeline: { alignItems: 'center', paddingTop: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  line: { width: 2, flex: 1, minHeight: 34, backgroundColor: colors.border, marginVertical: 3 },
  leg: { gap: 2 },
  legTime: { fontSize: 14, fontWeight: '800', color: colors.navy },
  legAddress: { fontSize: 13, color: colors.text, lineHeight: 18 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  badgeText: { fontSize: 12, fontWeight: '700', color: colors.navy },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 12 },
  emptyText: { color: colors.textMuted, marginTop: 6, textAlign: 'center' },
  emptyAddress: {
    color: colors.textMuted,
    marginTop: 4,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
  },
});
