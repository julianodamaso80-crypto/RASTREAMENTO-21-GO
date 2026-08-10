/**
 * Trava de configuração dos dois mundos de autenticação.
 *
 * O app é um binário só servindo associado e time interno. O que impede um
 * token de cliente de valer no painel é o segredo de assinatura ser OUTRO —
 * não um `if` em algum lugar. Se alguém apontar as duas variáveis pro mesmo
 * valor, o isolamento vira decoração e ninguém percebe. Por isso o processo
 * recusa subir em vez de logar um aviso que ninguém lê.
 */
const MIN_LENGTH = 32;

export const DEV_INTERNAL_SECRET = 'dev-secret';
export const DEV_ASSOCIATE_SECRET = 'dev-associate-secret';

export function assertJwtGuardRails(env: NodeJS.ProcessEnv): void {
  const isProd = env.NODE_ENV === 'production';
  const internal = env.JWT_SECRET ?? (isProd ? undefined : DEV_INTERNAL_SECRET);
  const associate =
    env.JWT_ASSOCIATE_SECRET ?? (isProd ? undefined : DEV_ASSOCIATE_SECRET);

  if (isProd) {
    if (!internal) throw new Error('JWT_SECRET é obrigatório em produção.');
    if (!associate) {
      throw new Error(
        'JWT_ASSOCIATE_SECRET é obrigatório em produção. Sem ele o token do ' +
          'associado seria verificável no painel interno.',
      );
    }
    if (internal.length < MIN_LENGTH || associate.length < MIN_LENGTH) {
      throw new Error(
        `Os segredos JWT precisam ter ao menos ${MIN_LENGTH} caracteres.`,
      );
    }
  }

  if (internal && associate && internal === associate) {
    throw new Error(
      'JWT_SECRET e JWT_ASSOCIATE_SECRET precisam ser diferentes. Iguais, ' +
        'um token de associado passa a valer no painel interno.',
    );
  }
}
