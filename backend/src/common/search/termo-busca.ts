/**
 * Núcleo de busca do painel.
 *
 * Quem atende raramente tem a placa na mão: tem o nome de quem ligou, o CPF do
 * cadastro, o número da linha do chip ou o IMEI escrito na caixa. Cada tela
 * montava seu próprio filtro e cobria um pedaço diferente — daí o mesmo termo
 * achar em Clientes Ativos e não achar no Estoque.
 *
 * A regra que não se negocia: `contains: ''` casa com TODAS as linhas. Um campo
 * só entra no OR quando existe algo de fato para casar nele.
 * Ver [[reference_busca_contains_vazio]].
 */

export interface TermoBusca {
  /** Termo cru, sem espaço nas pontas. Vale para nome, marca, modelo, cidade. */
  texto: string;
  /** Só os dígitos: CPF/CNPJ, IMEI, ICCID e telefone digitados com máscara. */
  digitos: string;
  /** A-Z0-9 em maiúsculas: placa e chassi, que aceitam ponto e hífen no meio. */
  alfanumerico: string;
  temLetra: boolean;
}

/** Grupos de campo por natureza — cada um tem sua regra de quando pode entrar. */
export interface CamposBuscaveis {
  /** Campos de texto livre (nome, marca, modelo, cidade, operadora). */
  texto?: string[];
  /** Placa e chassi: casam pelo termo sem pontuação, em maiúsculas. */
  alfanumerico?: string[];
  /** CPF/CNPJ: exige documento, não pedaço de número. */
  documento?: string[];
  /** IMEI, ICCID, linha, telefone: número comprido, casa por sufixo/pedaço. */
  identificador?: string[];
}

/**
 * Piso para procurar em campo numérico (CPF/CNPJ, IMEI, ICCID, linha).
 *
 * Três dígitos. O cliente ao telefone diz o final do documento, e o operador
 * digita os últimos dígitos do IMEI — exigir o número inteiro é barreira sem
 * ganho: medido em produção, "746" casa com 9 associados de 3.374. Abaixo de
 * três aí sim seria a base de volta ("46" pega metade do cadastro).
 *
 * Vale só para termo SEM letra — "sis1f13" nunca vira "113" (ver orDeCampos).
 */
const MIN_DIGITOS_NUMERO = 3;

export function interpretarTermo(bruto?: string | null): TermoBusca | null {
  const texto = (bruto ?? '').trim();
  if (!texto) return null;

  const digitos = texto.replace(/\D/g, '');
  const alfanumerico = texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!alfanumerico) return null;

  return {
    texto,
    digitos,
    alfanumerico,
    temLetra: /[A-Za-z]/.test(texto),
  };
}

/** Transforma 'associate.cpf' em { associate: { cpf: <filtro> } }. */
function aninhar(caminho: string, filtro: unknown): Record<string, unknown> {
  return caminho
    .split('.')
    .reverse()
    .reduce<unknown>((acc, parte) => ({ [parte]: acc }), filtro) as Record<
    string,
    unknown
  >;
}

/**
 * Monta o `OR` do Prisma a partir do termo. Lista vazia significa "não há campo
 * que possa casar" — quem chama deve responder nada encontrado, nunca ignorar o
 * filtro e devolver tudo.
 */
export function orDeCampos(
  termo: TermoBusca,
  campos: CamposBuscaveis,
): Record<string, unknown>[] {
  const or: Record<string, unknown>[] = [];

  for (const campo of campos.texto ?? []) {
    or.push(aninhar(campo, { contains: termo.texto, mode: 'insensitive' }));
  }

  for (const campo of campos.alfanumerico ?? []) {
    or.push(aninhar(campo, { contains: termo.alfanumerico }));
  }

  // Termo com letra nunca vira busca numérica: "sis1f13" viraria "113" e casaria
  // com qualquer IMEI, CPF ou telefone que contenha 113 — a base inteira.
  if (termo.temLetra) return or;

  if (termo.digitos.length >= MIN_DIGITOS_NUMERO) {
    for (const campo of [
      ...(campos.documento ?? []),
      ...(campos.identificador ?? []),
    ]) {
      or.push(aninhar(campo, { contains: termo.digitos }));
    }
  }

  return or;
}

/**
 * Atalho para o caso comum: devolve `{ OR: [...] }` pronto para espalhar no
 * `where`, ou `null` quando nada pode casar.
 */
export function filtroBusca(
  bruto: string | null | undefined,
  campos: CamposBuscaveis,
): { OR: Record<string, unknown>[] } | null {
  const termo = interpretarTermo(bruto);
  if (!termo) return null;
  const or = orDeCampos(termo, campos);
  return or.length ? { OR: or } : null;
}
