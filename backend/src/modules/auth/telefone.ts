/**
 * Formas em que um mesmo WhatsApp pode estar gravado no banco.
 *
 * O cadastro chega do SGA e do painel em formatos variados ("(21) 99834-5046",
 * "21998345046"), então a busca compara só os dígitos — e aceita o número com e
 * sem o 55 do Brasil. Número fora do tamanho brasileiro (10 ou 11 dígitos sem o
 * DDI) devolve lista vazia: não há o que procurar.
 *
 * Celular também é procurado com e sem o nono dígito: o SGA ainda guarda
 * alguns no formato antigo de 10 dígitos, e quem digitava o número completo
 * ouvia "não encontramos cadastro".
 */
export function variantesTelefone(bruto: string): string[] {
  const digitos = (bruto || '').replace(/\D/g, '');
  const semDdi =
    digitos.startsWith('55') && digitos.length >= 12
      ? digitos.slice(2)
      : digitos;
  if (semDdi.length !== 10 && semDdi.length !== 11) return [];
  const formas = [semDdi];
  const ddd = semDdi.slice(0, 2);
  const resto = semDdi.slice(2);
  // Fixo começa em 2-5; 6-9 em 10 dígitos é celular sem o nono dígito. Só
  // esse caso é equiparado — tirar o 9 de qualquer número cairia em fixo alheio.
  if (/^9[6-9]\d{7}$/.test(resto)) formas.push(ddd + resto.slice(1));
  if (/^[6-9]\d{7}$/.test(resto)) formas.push(`${ddd}9${resto}`);
  return formas.flatMap((f) => [f, `55${f}`]);
}
