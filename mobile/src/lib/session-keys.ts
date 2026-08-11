/**
 * Chaves do SecureStore e a regra de qual mundo abrir no boot.
 *
 * Cada mundo tem chave própria: não existe "o token" genérico no app. Uma tela
 * do associado é incapaz de montar uma requisição interna porque não alcança a
 * chave que guarda aquele token.
 */
export const ASSOCIATE_TOKEN_KEY = 'r21go.associate.token';
export const ASSOCIATE_NAME_KEY = 'r21go.associate.name';
export const ASSOCIATE_MUST_CHANGE_KEY = 'r21go.associate.mustChangePassword';

export const INTERNAL_TOKEN_KEY = 'r21go.internal.token';
export const INTERNAL_USER_KEY = 'r21go.internal.user';

/**
 * Último identificador (CPF ou e-mail) digitado com sucesso na tela de login.
 * É conveniência de preenchimento, não sessão: sobrevive ao logout dos dois
 * mundos porque logout apaga token, não a lembrança de "quem costuma entrar
 * neste aparelho".
 */
export const LAST_IDENTIFIER_KEY = 'r21go.login.lastIdentifier';

export type World = 'associate' | 'internal' | 'none';

/**
 * Só pode existir UMA sessão viva. Os dois tokens presentes ao mesmo tempo é
 * estado impossível — pode ser bug nosso ou adulteração do armazenamento. Nos
 * dois casos a resposta é a mesma: não abre nada, manda pro login. Quem tenta
 * adivinhar a intenção nesse ponto é quem vaza dado.
 */
export function resolveBootWorld(
  associateToken: string | null,
  internalToken: string | null,
): World {
  if (associateToken && internalToken) return 'none';
  if (internalToken) return 'internal';
  if (associateToken) return 'associate';
  return 'none';
}
