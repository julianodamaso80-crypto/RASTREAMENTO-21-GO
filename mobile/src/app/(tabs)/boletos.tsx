import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, RefreshControl, Alert as RNAlert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { AppApi } from '@/lib/api';
import { Boleto, estaVencido, tituloDoBoleto, valorEmReais } from '@/lib/boletos';
import { colors, radii } from '@/lib/theme';

export default function BoletosScreen() {
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [pendente, setPendente] = useState(false);
  const [rodape, setRodape] = useState({ titulo: '', telefones: '' });
  const [loading, setLoading] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);

  const carregar = useCallback(() => {
    return AppApi.boletos()
      .then((r) => {
        setBoletos(r.boletos);
        setPendente(r.pendente);
        setRodape(r.rodape);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setAtualizando(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar]),
  );

  async function copiar(boleto: Boleto) {
    if (!boleto.linhaDigitavel) return;
    await Clipboard.setStringAsync(boleto.linhaDigitavel);
    RNAlert.alert('Copiado', 'Código do boleto copiado. Cole no app do seu banco para pagar.');
  }

  async function baixar(boleto: Boleto) {
    setBaixandoId(boleto.id);
    try {
      const uri = await AppApi.baixarBoletoPdf(boleto.id);
      const podeCompartilhar = await Sharing.isAvailableAsync();
      if (podeCompartilhar) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      } else {
        RNAlert.alert('Boleto baixado', 'Não foi possível abrir o boleto automaticamente.');
      }
    } catch {
      RNAlert.alert('Não deu para abrir', 'Tente de novo em instantes.');
    } finally {
      setBaixandoId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Boletos</Text>

      {loading ? (
        <ActivityIndicator color={colors.navy} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.lista}
          refreshControl={
            <RefreshControl
              refreshing={atualizando}
              onRefresh={() => {
                setAtualizando(true);
                carregar();
              }}
              tintColor={colors.navy}
            />
          }
        >
          {boletos.length === 0 && pendente ? (
            // Nunca dizer "em dia" a quem ainda não foi conferido.
            <View style={styles.vazio}>
              <Ionicons name="time-outline" size={44} color={colors.textFaint} />
              <Text style={styles.vazioTitulo}>Estamos buscando seus boletos</Text>
              <Text style={styles.vazioTexto}>
                Eles aparecem aqui a partir da próxima segunda-feira.
              </Text>
            </View>
          ) : boletos.length === 0 ? (
            <View style={styles.vazio}>
              <Ionicons name="checkmark-circle" size={44} color={colors.navy} />
              <Text style={styles.vazioTitulo}>Você está em dia</Text>
              <Text style={styles.vazioTexto}>Nenhum boleto em aberto.</Text>
            </View>
          ) : (
            boletos.map((b) => {
              const vencido = estaVencido(b.rotulo);
              const baixando = baixandoId === b.id;
              return (
                <View key={b.id} style={styles.card}>
                  <Text style={styles.placa}>{b.placa ?? 'Veículo'}</Text>
                  <Text style={styles.mes}>{tituloDoBoleto(b.mesReferente)}</Text>

                  <View style={styles.linhaValor}>
                    <Text style={styles.valor}>{valorEmReais(b.valor)}</Text>
                    <Text style={[styles.rotulo, vencido && styles.rotuloVencido]}>
                      {b.rotulo}
                    </Text>
                  </View>

                  <View style={styles.botoes}>
                    <TouchableOpacity
                      style={[styles.botao, !b.linhaDigitavel && styles.botaoDesligado]}
                      disabled={!b.linhaDigitavel}
                      onPress={() => copiar(b)}
                    >
                      <Ionicons name="copy-outline" size={16} color={colors.navy} />
                      <Text style={styles.botaoTexto}>Copiar código</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.botao, styles.botaoCheio, !b.temPdf && styles.botaoDesligado]}
                      disabled={!b.temPdf || baixando}
                      onPress={() => baixar(b)}
                    >
                      {baixando ? (
                        <ActivityIndicator size="small" color={colors.white} />
                      ) : (
                        <Ionicons name="download-outline" size={16} color={colors.white} />
                      )}
                      <Text style={[styles.botaoTexto, styles.botaoTextoCheio]}>
                        {baixando ? 'Abrindo...' : 'Baixar boleto'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}

          <View style={styles.rodape}>
            <Text style={styles.rodapeTitulo}>{rodape.titulo}</Text>
            <Text style={styles.rodapeTelefones}>{rodape.telefones}</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  title: { fontSize: 24, fontWeight: '700', color: colors.navy, padding: 20, paddingBottom: 8 },
  lista: { padding: 16, paddingTop: 4, gap: 12 },
  card: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg,
    padding: 16, backgroundColor: colors.white, gap: 4,
  },
  placa: { fontSize: 15, fontWeight: '700', color: colors.navy },
  mes: { fontSize: 13, color: colors.textFaint },
  linhaValor: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-end', marginTop: 8,
  },
  valor: { fontSize: 22, fontWeight: '700', color: colors.navy },
  rotulo: { fontSize: 13, color: colors.textFaint },
  rotuloVencido: { color: colors.red, fontWeight: '700' },
  botoes: { flexDirection: 'row', gap: 8, marginTop: 14 },
  botao: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.navy,
  },
  botaoCheio: { backgroundColor: colors.navy },
  botaoDesligado: { opacity: 0.4 },
  botaoTexto: { fontSize: 13, fontWeight: '600', color: colors.navy },
  botaoTextoCheio: { color: colors.white },
  vazio: { alignItems: 'center', paddingVertical: 48, gap: 6 },
  vazioTitulo: { fontSize: 17, fontWeight: '700', color: colors.navy },
  vazioTexto: { fontSize: 14, color: colors.textFaint },
  rodape: { marginTop: 24, paddingHorizontal: 4, gap: 4 },
  rodapeTitulo: { fontSize: 13, color: colors.textFaint, textAlign: 'center' },
  rodapeTelefones: {
    fontSize: 14, fontWeight: '700', color: colors.navy, textAlign: 'center',
  },
});
