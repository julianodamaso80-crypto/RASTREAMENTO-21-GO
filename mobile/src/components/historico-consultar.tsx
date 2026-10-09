import { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { AppApi, HistoryReport, HistoryReportType } from '@/lib/api';
import { colors, radii } from '@/lib/theme';

const PERIODOS = [
  { rotulo: '1 hora', min: 60 },
  { rotulo: '24 horas', min: 1440 },
  { rotulo: '48 horas', min: 2880 },
  { rotulo: '72 horas', min: 4320 },
  { rotulo: '7 dias', min: 10080 },
];

const TIPOS: { id: HistoryReportType; rotulo: string }[] = [
  { id: 'basico', rotulo: 'Básico' },
  { id: 'avancado', rotulo: 'Avançado' },
  { id: 'consolidado', rotulo: 'Consolidado' },
];

const LINHAS_NA_TELA = 200;

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function duracao(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function distancia(m: number | null, kmh: number): string {
  if (m === null) return '—';
  if (m === 0 && kmh === 0) return 'Parado';
  return m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} km` : `${m} m`;
}

export function HistoricoConsultar({ vehicleId }: { vehicleId: string }) {
  const [minutos, setMinutos] = useState(1440);
  const [tipo, setTipo] = useState<HistoryReportType>('basico');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState<HistoryReport | null>(null);

  async function buscar() {
    setCarregando(true);
    setErro(null);
    try {
      const fim = new Date();
      const inicio = new Date(fim.getTime() - minutos * 60_000);
      setRelatorio(await AppApi.historyReport(vehicleId, inicio.toISOString(), fim.toISOString(), tipo));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      setRelatorio(null);
      setErro(msg || 'Não foi possível gerar o relatório agora.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.titulo}>Período</Text>
      <View style={styles.linha}>
        {PERIODOS.map((p) => (
          <TouchableOpacity
            key={p.min}
            onPress={() => setMinutos(p.min)}
            style={[styles.chip, minutos === p.min && styles.chipOn]}
          >
            <Text style={[styles.chipText, minutos === p.min && styles.chipTextOn]}>{p.rotulo}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.titulo}>Tipo de relatório</Text>
      <View style={styles.linha}>
        {TIPOS.map((t) => (
          <TouchableOpacity
            key={t.id}
            onPress={() => setTipo(t.id)}
            style={[styles.chip, tipo === t.id && styles.chipOn]}
          >
            <Text style={[styles.chipText, tipo === t.id && styles.chipTextOn]}>{t.rotulo}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity onPress={buscar} disabled={carregando} style={styles.buscar}>
        {carregando ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buscarText}>Buscar</Text>}
      </TouchableOpacity>

      {erro && <Text style={styles.erro}>{erro}</Text>}

      {relatorio && (
        <View style={styles.card}>
          <Text style={styles.cardTitulo}>Ativo: {relatorio.plate}</Text>
          <Text style={styles.cardLinha}>
            Período: {dataHora(relatorio.from)} a {dataHora(relatorio.to)}
          </Text>
          <Text style={styles.cardLinha}>
            Ignição ligada total: {duracao(relatorio.totals.ignitionOnMin)}
          </Text>
          <Text style={styles.cardLinha}>
            Ignição desligada total: {duracao(relatorio.totals.ignitionOffMin)}
          </Text>
          <Text style={styles.cardLinha}>
            Distância percorrida total: {relatorio.totals.distanceKm.toFixed(2).replace('.', ',')} km
          </Text>
        </View>
      )}

      {relatorio && relatorio.type === 'consolidado' &&
        (relatorio.days.length === 0 ? (
          <Text style={styles.vazio}>Nenhum registro foi encontrado!</Text>
        ) : (
          relatorio.days.map((d) => (
            <View key={d.date} style={styles.card}>
              <Text style={styles.cardTitulo}>{d.date.split('-').reverse().join('/')}</Text>
              <Text style={styles.cardLinha}>Velocidade máxima: {d.maxSpeed} km/h</Text>
              <Text style={styles.cardLinha}>{d.address ?? 'Endereço indisponível'}</Text>
            </View>
          ))
        ))}

      {relatorio && relatorio.type !== 'consolidado' &&
        (relatorio.rows.length === 0 ? (
          <Text style={styles.vazio}>Nenhum registro foi encontrado!</Text>
        ) : (
          <>
            {relatorio.rows.slice(0, LINHAS_NA_TELA).map((l, i) => (
              <View key={`${l.time}-${i}`} style={styles.card}>
                <Text style={styles.cardTitulo}>{dataHora(l.time)}</Text>
                <Text style={styles.cardLinha}>
                  {l.speed} km/h · Ignição {l.ignition === null ? '—' : l.ignition ? 'ligada' : 'desligada'} ·{' '}
                  {distancia(l.distanceM, l.speed)}
                </Text>
                <Text style={styles.cardLinha}>
                  {l.address ?? `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`}
                </Text>
                {l.event ? <Text style={styles.cardLinha}>Evento: {l.event}</Text> : null}
                {relatorio.type === 'avancado' && (
                  <Text style={styles.cardMuted}>
                    GPRS {l.gprs ? dataHora(l.gprs) : '—'} · GPS {l.gps ? dataHora(l.gps) : '—'} · {l.direction ?? ''}
                  </Text>
                )}
              </View>
            ))}
            {relatorio.rows.length > LINHAS_NA_TELA && (
              <Text style={styles.vazio}>
                Mostrando {LINHAS_NA_TELA} de {relatorio.rows.length} registros. Para ver todos, use um período menor.
              </Text>
            )}
          </>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  titulo: { fontWeight: '700', fontSize: 13, color: colors.text },
  linha: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: colors.white },
  buscar: {
    backgroundColor: colors.orange,
    borderRadius: radii.lg,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buscarText: { color: colors.white, fontWeight: '700', fontSize: 15 },
  erro: { color: '#b91c1c', fontSize: 13 },
  vazio: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 8 },
  card: {
    padding: 12,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 3,
  },
  cardTitulo: { fontWeight: '700', fontSize: 13, color: colors.text },
  cardLinha: { fontSize: 12, color: colors.text },
  cardMuted: { fontSize: 11, color: colors.textMuted },
});
