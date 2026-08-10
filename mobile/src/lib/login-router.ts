/**
 * Decide, ANTES de qualquer chamada de rede, pra qual mundo o login vai.
 *
 * Associado entra por CPF; time interno entra por e-mail. A decisão é local de
 * propósito: se o app perguntasse ao servidor "esse identificador é de quem?",
 * qualquer pessoa com o app na mão teria um verificador de quais e-mails
 * pertencem ao time — primeiro passo de ataque dirigido.
 */
export type LoginTarget = 'associate' | 'internal' | 'invalid';

export function resolveLoginTarget(input: string): LoginTarget {
  const valor = (input || '').trim();
  if (valor.length === 0) return 'invalid';
  // Arroba manda: e-mail é sempre mundo interno, mesmo que comece com números.
  if (valor.includes('@')) return 'internal';
  const digitos = valor.replace(/\D/g, '');
  // Só aceita como CPF o que é de fato número e máscara — "joao123" não passa.
  if (digitos.length === 11 && /^[\d.\-\s]+$/.test(valor)) return 'associate';
  return 'invalid';
}
