import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UrlTile, type MapType } from 'react-native-maps';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { colors, radii } from '@/lib/theme';

/**
 * Os três mapas do sistema, iguais aos da web: Padrão, Satélite grátis (Esri)
 * e Satélite Google. A escolha vale para todos os mapas do app e fica
 * guardada no aparelho.
 */
export type TipoMapa = 'padrao' | 'gratis' | 'google';

const CHAVE = 'map_type';

const OPCOES: { id: TipoMapa; rotulo: string; icone: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'padrao', rotulo: 'Padrão', icone: 'map-outline' },
  { id: 'gratis', rotulo: 'Satélite grátis', icone: 'earth-outline' },
  { id: 'google', rotulo: 'Satélite Google', icone: 'globe-outline' },
];

interface MapTypeState {
  tipo: TipoMapa;
  carregado: boolean;
  carregar: () => Promise<void>;
  escolher: (t: TipoMapa) => void;
}

export const useMapType = create<MapTypeState>((set, get) => ({
  tipo: 'padrao',
  carregado: false,
  carregar: async () => {
    if (get().carregado) return;
    try {
      const salvo = await SecureStore.getItemAsync(CHAVE);
      if (salvo === 'padrao' || salvo === 'gratis' || salvo === 'google') set({ tipo: salvo });
    } catch {
      // Sem acesso ao armazenamento: fica no Padrão.
    }
    set({ carregado: true });
  },
  escolher: (t) => {
    set({ tipo: t });
    SecureStore.setItemAsync(CHAVE, t).catch(() => undefined);
  },
}));

/**
 * `mapType` do Google para cada opção. No "Satélite grátis" o Google fica no
 * Padrão por baixo da foto do Esri: se um pedaço da foto não carregar, aparece
 * a rua em vez de um buraco.
 */
export function mapTypeDe(tipo: TipoMapa): MapType {
  return tipo === 'google' ? 'hybrid' : 'standard';
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

/** Foto do Esri com nomes de lugares e ruas por cima. Só no "Satélite grátis". */
export function CamadaSateliteGratis({ tipo }: { tipo: TipoMapa }) {
  if (tipo !== 'gratis') return null;
  return (
    <>
      {/* Acima do z19 o Esri não tem foto no Brasil: o mapa amplia o z19. */}
      <UrlTile urlTemplate={`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`} maximumNativeZ={19} zIndex={1} />
      <UrlTile urlTemplate={`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`} zIndex={2} />
      <UrlTile urlTemplate={`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`} zIndex={3} />
    </>
  );
}

/** Botão de camadas: toca e escolhe entre os três mapas. */
export function MapTypeSwitch({ top = 12 }: { top?: number }) {
  const tipo = useMapType((s) => s.tipo);
  const escolher = useMapType((s) => s.escolher);
  const carregar = useMapType((s) => s.carregar);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <View style={[styles.wrap, { top }]} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.botao}
        onPress={() => setAberto((a) => !a)}
        activeOpacity={0.85}
        accessibilityLabel="Escolher o tipo de mapa"
      >
        <Ionicons name="layers-outline" size={22} color={colors.navy} />
      </TouchableOpacity>
      {aberto && (
        <View style={styles.menu}>
          {OPCOES.map((o) => {
            const ativo = o.id === tipo;
            return (
              <TouchableOpacity
                key={o.id}
                style={[styles.opcao, ativo && styles.opcaoAtiva]}
                onPress={() => {
                  escolher(o.id);
                  setAberto(false);
                }}
                activeOpacity={0.85}
                accessibilityLabel={`Mudar mapa para ${o.rotulo}`}
              >
                <Ionicons name={o.icone} size={16} color={ativo ? colors.white : colors.navy} />
                <Text style={[styles.rotulo, ativo && styles.rotuloAtivo]}>{o.rotulo}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const sombra = {
  shadowColor: '#000',
  shadowOpacity: 0.2,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 4,
};

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 12, alignItems: 'flex-end', zIndex: 10 },
  botao: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...sombra,
  },
  menu: {
    marginTop: 8,
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: 4,
    gap: 2,
    ...sombra,
  },
  opcao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.md,
  },
  opcaoAtiva: { backgroundColor: colors.navy },
  rotulo: { color: colors.navy, fontSize: 14, fontWeight: '600' },
  rotuloAtivo: { color: colors.white },
});
