/**
 * Documento do associado no login do app.
 *
 * A base tem pessoa física e pessoa jurídica: o campo `cpf` do associado
 * guarda CPF (11 dígitos) ou CNPJ (14), conforme veio do SGA. Tratar só 11
 * dígitos deixava o associado PJ sem entrar no app — com rastreador instalado
 * e mandando o documento certo como senha, ele levava o mesmo 401 de senha
 * errada.
 */

/** Tira máscara, deixando só dígitos. */
export function normalizeDoc(doc: string): string {
  return (doc || '').replace(/\D/g, '');
}

/** Aplica a máscara oficial do documento; devolve `null` se o tamanho não fecha. */
export function mascaraDoc(digits: string): string | null {
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5',
    );
  }
  return null;
}

/**
 * Formatos em que o documento pode ter sido gravado: só dígitos ou com
 * máscara — o SGA devolve dos dois jeitos.
 */
export function docVariants(digits: string): string[] {
  const comMascara = mascaraDoc(digits);
  return comMascara ? [digits, comMascara] : [digits];
}

/**
 * O documento vale como senha só no primeiro acesso (ver `mustChangePassword`
 * no serviço). Exige tamanho de documento real: sem isso, um cadastro com
 * documento truncado viraria senha curta e adivinhável.
 */
export function senhaEhODocumento(docDoCadastro: string, digitado: string): boolean {
  const doc = normalizeDoc(docDoCadastro);
  if (doc.length !== 11 && doc.length !== 14) return false;
  return normalizeDoc(digitado) === doc;
}
