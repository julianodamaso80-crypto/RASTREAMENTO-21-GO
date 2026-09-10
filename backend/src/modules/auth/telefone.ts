/**
 * Formas em que um mesmo WhatsApp pode estar gravado no banco.
 *
 * O cadastro chega do SGA e do painel em formatos variados ("(21) 99834-5046",
 * "21998345046"), então a busca compara só os dígitos — e aceita o número com e
 * sem o 55 do Brasil. Número fora do tamanho brasileiro (10 ou 11 dígitos sem o
 * DDI) devolve lista vazia: não há o que procurar.
 */
export function variantesTelefone(bruto: string): string[] {
  const digitos = (bruto || '').replace(/\D/g, '');
  const semDdi =
    digitos.startsWith('55') && digitos.length >= 12
      ? digitos.slice(2)
      : digitos;
  if (semDdi.length !== 10 && semDdi.length !== 11) return [];
  return [semDdi, `55${semDdi}`];
}
