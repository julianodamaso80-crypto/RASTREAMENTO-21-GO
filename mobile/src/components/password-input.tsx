import { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/theme';

interface Props extends Omit<TextInputProps, 'secureTextEntry' | 'style'> {
  /** Estilo do campo — cada tela tem o seu `styles.input`. */
  inputStyle?: TextInputProps['style'];
  wrapperStyle?: StyleProp<ViewStyle>;
}

/**
 * Campo de senha com olho de mostrar/ocultar.
 *
 * Senha escondida por padrão, mas quem digita precisa poder conferir o que
 * escreveu — sem isso, errar a senha nova e só descobrir na mensagem de "as
 * duas não são iguais" é o caminho normal, não a exceção.
 */
export function PasswordInput({ inputStyle, wrapperStyle, ...rest }: Props) {
  const [visivel, setVisivel] = useState(false);
  return (
    <View style={[styles.wrap, wrapperStyle]}>
      <TextInput
        {...rest}
        secureTextEntry={!visivel}
        placeholderTextColor={rest.placeholderTextColor ?? colors.textFaint}
        style={[inputStyle, styles.input]}
      />
      <TouchableOpacity
        onPress={() => setVisivel((v) => !v)}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.eye}
        accessibilityRole="button"
        accessibilityLabel={visivel ? 'Ocultar senha' : 'Mostrar senha'}
      >
        <Ionicons
          name={visivel ? 'eye-off-outline' : 'eye-outline'}
          size={20}
          color={colors.textMuted}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  // Espaço reservado à direita pra senha longa não passar por baixo do olho.
  input: { paddingRight: 48 },
  eye: {
    position: 'absolute',
    right: 4,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
});
