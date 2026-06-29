import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '@/lib/theme';

/** Marca-símbolo 21 Go — círculo laranja + pin limão. */
export function BrandMark({ size = 44 }: { size?: number }) {
  const inner = Math.round(size * 0.5);
  return (
    <View
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: size * 0.28 },
      ]}
    >
      <Svg width={inner} height={inner} viewBox="0 0 64 64">
        <Circle
          cx="32"
          cy="32"
          r="22"
          fill="none"
          stroke={colors.orange}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray="115 6"
          transform="rotate(-30 32 32)"
        />
        <Path
          d="M22 36c0-4.4 3.6-8 8-8s8 3.6 8 8c0 6-8 14-8 14s-8-8-8-14z"
          fill={colors.lime}
        />
        <Circle cx="30" cy="36" r="3" fill={colors.white} />
      </Svg>
    </View>
  );
}

/** Marca completa: símbolo + "21 Go" + tagline. */
export function BrandLockup({ light = false }: { light?: boolean }) {
  return (
    <View style={styles.row}>
      <BrandMark size={48} />
      <View>
        <Text
          style={[styles.word, { color: light ? colors.white : colors.text }]}
        >
          21 <Text style={{ color: colors.orange }}>Go</Text>
        </Text>
        <Text
          style={[
            styles.tag,
            { color: light ? 'rgba(255,255,255,0.7)' : colors.textMuted },
          ]}
        >
          RASTREAMENTO
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  word: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  tag: { fontSize: 10, fontWeight: '700', letterSpacing: 2, marginTop: 2 },
});
