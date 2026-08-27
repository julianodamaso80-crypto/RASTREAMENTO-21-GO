import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppApi, Alert } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { colors, radii } from '@/lib/theme';

const JANELA_MS = 24 * 3600_000;
const RECARGA_MS = 60_000;

/**
 * Aviso no topo do mapa, no lugar da antiga aba de alertas. O backend já corta
 * o ruído (ignição, offline, condução brusca); o que chega aqui é o que faz o
 * dono agir — corte de energia, jammer, SOS, excesso de velocidade.
 *
 * Some sozinho depois de 24h e pode ser dispensado no X: aviso que não sai da
 * tela vira paisagem e para de ser lido.
 */
export function AlertBanner() {
  const [alerta, setAlerta] = useState<Alert | null>(null);
  const [restantes, setRestantes] = useState(0);
  const [dispensados, setDispensados] = useState<string[]>([]);

  const carregar = useCallback(async () => {
    try {
      const lista = await AppApi.alerts(20);
      const limite = Date.now() - JANELA_MS;
      const recentes = lista.filter(
        (a) => new Date(a.createdAt).getTime() >= limite,
      );
      setAlerta(recentes[0] ?? null);
      setRestantes(Math.max(0, recentes.length - 1));
    } catch {
      // silencioso: banner é acessório, mapa nunca depende dele
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, RECARGA_MS);
    return () => clearInterval(id);
  }, [carregar]);

  if (!alerta || dispensados.includes(alerta.id)) return null;

  const critico = alerta.severity === 'CRITICAL';
  const cor = critico ? colors.red : colors.orange;

  return (
    <View style={[styles.banner, { backgroundColor: cor }]}>
      <Ionicons
        name={critico ? 'alert-circle' : 'warning'}
        size={20}
        color={colors.white}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.message} numberOfLines={2}>
          {alerta.message}
        </Text>
        <Text style={styles.meta}>
          {alerta.vehicle?.plate ? `${alerta.vehicle.plate} · ` : ''}
          {timeAgo(alerta.createdAt)}
          {restantes > 0 ? ` · +${restantes} aviso${restantes > 1 ? 's' : ''}` : ''}
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => setDispensados((d) => [...d, alerta.id])}
        hitSlop={10}
      >
        <Ionicons name="close" size={20} color={colors.white} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.lg,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  message: { color: colors.white, fontWeight: '700', fontSize: 14 },
  meta: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
});
