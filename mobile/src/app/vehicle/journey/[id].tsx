import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppApi, JourneyDay, JourneyTrip } from '@/lib/api';
import { colors, radii } from '@/lib/theme';
import { HistoricoConsultar } from '@/components/historico-consultar';

const DIAS = 31;

/** Dia civil de Brasília (UTC−3) como AAAA-MM-DD. */
function diaBrasilia(instante: number): string {
  return new Date(instante - 3 * 3600_000).toISOString().slice(0, 10);
}

function rotuloDia(dia: string, i: number): string {
  if (i === 0) return 'Hoje';
  if (i === 1) return 'Ontem';
  const [, m, d] = dia.split('-');
  return `${d}/${m}`;
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function km(v: number): string {
  return v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1).replace('.', ',')} km`;
}

function duracao(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export default function VehicleJourneyScreen() {
  const { id, plate } = useLocalSearchParams<{ id: string; plate?: string }>();
  const dias = useMemo(
    () => Array.from({ length: DIAS }, (_, i) => diaBrasilia(Date.now() - i * 86_400_000)),
    [],
  );
  const [dia, setDia] = useState(dias[0]);
  const [journey, setJourney] = useState<JourneyDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [escolhida, setEscolhida] = useState(0);
  const [detalhes, setDetalhes] = useState(false);
  const [aba, setAba] = useState<'viagens' | 'consultar'>('viagens');
  const mapa = useRef<MapView>(null);

  useEffect(() => {
    if (!id) return;
    let cancelado = false;
    setLoading(true);
    setErro(false);
    AppApi.journey(id, dia)
      .then((j) => {
        if (cancelado) return;
        setJourney(j);
        setEscolhida(0);
        setDetalhes(false);
      })
      .catch(() => {
        if (cancelado) return;
        setJourney(null);
        setErro(true);
      })
      .finally(() => !cancelado && setLoading(false));
    return () => {
      cancelado = true;
    };
  }, [id, dia]);

  const trips = journey?.trips ?? [];
  const viagem: JourneyTrip | undefined = trips[escolhida];
  const coords = useMemo(
    () => (viagem?.path ?? []).map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [viagem],
  );

  const enquadrar = useCallback(() => {
    if (coords.length > 1) {
      mapa.current?.fitToCoordinates(coords, {
        edgePadding: { top: 60, right: 40, bottom: 60, left: 40 },
        animated: false,
      });
    }
  }, [coords]);

  useEffect(() => {
    enquadrar();
  }, [enquadrar]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: plate ? String(plate) : 'Histórico' }} />

      <View style={styles.abas}>
        {(['viagens', 'consultar'] as const).map((a) => (
          <TouchableOpacity key={a} onPress={() => setAba(a)} style={[styles.aba, aba === a && styles.abaOn]}>
            <Text style={[styles.abaText, aba === a && styles.abaTextOn]}>
              {a === 'viagens' ? 'Viagens' : 'Consultar'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {aba === 'consultar' ? (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
          <HistoricoConsultar vehicleId={String(id)} />
        </ScrollView>
      ) : (
      <>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dias}>
          {dias.map((d, i) => (
            <TouchableOpacity
              key={d}
              onPress={() => setDia(d)}
              style={[styles.chip, d === dia && styles.chipOn]}
            >
              <Text style={[styles.chipText, d === dia && styles.chipTextOn]}>{rotuloDia(d, i)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.mapWrap}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.navy} size="large" />
          </View>
        ) : coords.length < 2 ? (
          <View style={styles.center}>
            <Ionicons name="trail-sign-outline" size={42} color={colors.textFaint} />
            <Text style={styles.empty}>
              {erro ? 'Não foi possível carregar agora.' : 'Nenhuma viagem encontrada nesse dia.'}
            </Text>
          </View>
        ) : (
          <MapView
            ref={mapa}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            mapType="hybrid"
            onMapReady={enquadrar}
          >
            <Polyline coordinates={coords} strokeColor={colors.orange} strokeWidth={5} />
            <Marker coordinate={coords[0]} pinColor="green" title="Saída" />
            <Marker coordinate={coords[coords.length - 1]} pinColor="red" title="Chegada" />
          </MapView>
        )}
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 12, gap: 10 }}>
        {trips.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {trips.map((t, i) => (
              <View key={t.startTime} style={styles.tripRow}>
                <TouchableOpacity
                  onPress={() => {
                    setEscolhida(i);
                    setDetalhes(false);
                  }}
                  style={[styles.trip, i === escolhida && styles.tripOn]}
                >
                  <Text style={styles.tripTitle}>
                    Viagem {i + 1} · {hora(t.startTime)} às {hora(t.endTime)}
                  </Text>
                  <Text style={styles.tripSub}>
                    {km(t.distanceKm)} · {duracao(t.durationMin)}
                  </Text>
                  <Text style={styles.tripSub}>
                    máx {t.maxSpeed} km/h · média {t.avgSpeed} km/h
                  </Text>
                </TouchableOpacity>
                {t.stopAfterMin !== null && (
                  <View style={styles.parada}>
                    <Ionicons name="timer-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.paradaText}>{duracao(t.stopAfterMin)}</Text>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
        )}

        {viagem && (
          <View style={styles.info}>
            <Text style={styles.infoTitle}>Informações da viagem</Text>
            <Text style={styles.infoLine}>
              Saída: {viagem.startAddress ?? 'Endereço indisponível'}
            </Text>
            <Text style={styles.infoLine}>
              Chegada: {viagem.endAddress ?? 'Endereço indisponível'}
            </Text>
            <Text style={styles.infoLine}>Tempo da viagem: {duracao(viagem.durationMin)}</Text>
            <Text style={styles.infoLine}>Percurso: {km(viagem.distanceKm)}</Text>
            <TouchableOpacity onPress={() => setDetalhes((d) => !d)} style={styles.detalhesBtn}>
              <Ionicons name={detalhes ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.navy} />
              <Text style={styles.detalhesText}>Detalhes da viagem</Text>
            </TouchableOpacity>
            {detalhes &&
              viagem.path.map((p) => (
                <View key={p.time} style={styles.ponto}>
                  <Text style={styles.pontoText}>{hora(p.time)}</Text>
                  <Text style={styles.pontoText}>{p.speed} km/h</Text>
                  <Text style={styles.pontoMuted}>
                    Ignição {p.ignition === null ? '—' : p.ignition ? 'ligada' : 'desligada'}
                  </Text>
                </View>
              ))}
          </View>
        )}
      </ScrollView>
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  abas: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card },
  aba: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  abaOn: { borderBottomColor: colors.orange },
  abaText: { color: colors.textMuted, fontWeight: '600', fontSize: 14 },
  abaTextOn: { color: colors.text },
  dias: { padding: 10, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: colors.white },
  mapWrap: { height: 280, backgroundColor: colors.border },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  empty: { color: colors.textMuted, fontSize: 14 },
  panel: { flex: 1 },
  tripRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trip: {
    padding: 10,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 190,
  },
  tripOn: { borderColor: colors.orange, backgroundColor: '#fff7ed' },
  tripTitle: { fontWeight: '700', fontSize: 13, color: colors.text },
  tripSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  parada: { alignItems: 'center' },
  paradaText: { fontSize: 11, color: colors.textMuted },
  info: {
    padding: 12,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  infoTitle: { fontWeight: '700', fontSize: 14, color: colors.text, marginBottom: 4 },
  infoLine: { fontSize: 13, color: colors.text },
  detalhesBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  detalhesText: { color: colors.navy, fontWeight: '600', fontSize: 13 },
  ponto: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pontoText: { fontSize: 12, color: colors.text },
  pontoMuted: { fontSize: 12, color: colors.textMuted },
});
