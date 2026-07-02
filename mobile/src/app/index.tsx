import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth-store';

/**
 * Rota inicial "/". Sem esta tela o app abre numa rota inexistente e fica em
 * branco (bug pego pela App Review). Redireciona conforme o login já carregado.
 */
export default function Index() {
  const token = useAuth((s) => s.token);
  return <Redirect href={token ? '/(tabs)' : '/login'} />;
}
