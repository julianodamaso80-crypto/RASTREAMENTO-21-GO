import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AppApi, HistoryRequest } from '@/lib/api';
import { colors, radii } from '@/lib/theme';

const TIPO: Record<string, string> = {
  basico: 'Básico',
  avancado: 'Avançado',
  consolidado: 'Consolidado',
};

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Abrir o PDF (o navegador do celular baixa e imprime) e mandar o link. */
export function AcoesDoPdf({ item }: { item: HistoryRequest }) {
  if (item.expired) {
    return <Text style={styles.muted}>O link expirou. Gere um novo histórico.</Text>;
  }
  return (
    <View style={styles.acoes}>
      <TouchableOpacity style={styles.botao} onPress={() => Linking.openURL(item.url)}>
        <Text style={styles.botaoText}>Abrir / baixar PDF</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.botao, styles.botaoClaro]}
        onPress={() =>
          Share.share({ message: `Histórico de localização do veículo ${item.plate}: ${item.url}` })
        }
      >
        <Text style={[styles.botaoText, styles.botaoClaroText]}>Compartilhar link</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Aba "Solicitados": os PDFs que o associado já gerou para este veículo. */
export function HistoricoSolicitados({ vehicleId, versao }: { vehicleId: string; versao: number }) {
  const [itens, setItens] = useState<HistoryRequest[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setItens(await AppApi.historyRequests(vehicleId));
    } catch {
      setErro('Não foi possível carregar os históricos.');
    } finally {
      setCarregando(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    void carregar();
  }, [carregar, versao]);

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.muted}>Históricos que você já gerou em PDF. O link abre por 90 dias.</Text>
      {carregando && !itens && <ActivityIndicator color={colors.orange} />}
      {erro && <Text style={styles.erro}>{erro}</Text>}
      {itens && itens.length === 0 && (
        <Text style={styles.vazio}>
          Nenhum histórico gerado ainda. Use a aba Consultar e toque em Gerar PDF.
        </Text>
      )}
      {itens?.map((item) => (
        <View key={item.id} style={styles.card}>
          <Text style={styles.titulo}>
            {dataHora(item.from)} → {dataHora(item.to)}
          </Text>
          <Text style={styles.muted}>
            {TIPO[item.type] ?? item.type} · gerado em {dataHora(item.createdAt)} · nº {item.number}
          </Text>
          <AcoesDoPdf item={item} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 12,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  titulo: { fontWeight: '700', fontSize: 13, color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted },
  erro: { color: '#b91c1c', fontSize: 13 },
  vazio: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 8 },
  acoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  botao: {
    backgroundColor: colors.orange,
    borderRadius: radii.lg,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  botaoText: { color: colors.white, fontWeight: '700', fontSize: 13 },
  botaoClaro: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.orange },
  botaoClaroText: { color: colors.orange },
});
