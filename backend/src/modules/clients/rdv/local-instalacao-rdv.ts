/**
 * Leitura do relatório de Ativos da plataforma de origem (RedeVeiculos):
 * `GET /veiculos/VeiculosController?exportacao=todos` devolve a planilha como
 * `[[{text}], ...]` — primeira linha é o cabeçalho.
 *
 * O que interessa aqui é a coluna "Local da instalação do equipamento": é a
 * única fonte de onde o rastreador/TAG foi escondido nos ativos migrados, que
 * nasceram no 21 GO sem esse dado.
 */
export type LinhaExport = Array<{ text: string }>;

export interface LocalRdv {
  /** IMEI do rastreador sem os zeros à esquerda que a planilha acrescenta. */
  imei: string | null;
  /** "Identificador" — é o número de série da TAG (e do rastreador também). */
  identificador: string | null;
  modelo: string;
  /** TAG (KTAG, REDETAG, TAG-GT06…) ou rastreador GPS. */
  tag: boolean;
  placa: string | null;
  local: string;
}

const COL_LOCAL = 'Local da instalação do equipamento';
const NAO_INFORMADO = /^n[aã]o informado$/i;

function texto(linha: LinhaExport, i: number): string {
  return i >= 0 ? (linha[i]?.text ?? '').trim() : '';
}

/**
 * Só as linhas que dizem onde o equipamento está. "Não informado" na Rede é o
 * mesmo que vazio aqui: não vale gravar.
 */
export function lerLocaisRdv(planilha: LinhaExport[]): LocalRdv[] {
  if (planilha.length === 0) return [];
  const cab = planilha[0].map((c) => (c?.text ?? '').trim());
  const iLocal = cab.indexOf(COL_LOCAL);
  if (iLocal < 0) {
    throw new Error(`Planilha sem a coluna "${COL_LOCAL}".`);
  }
  const iImei = cab.indexOf('Imei');
  const iId = cab.indexOf('Identificador');
  const iModelo = cab.indexOf('Modelo rastreador');
  const iPlaca = cab.indexOf('Placa');

  const saida: LocalRdv[] = [];
  for (const linha of planilha.slice(1)) {
    const local = texto(linha, iLocal);
    if (!local || NAO_INFORMADO.test(local)) continue;
    const imei = texto(linha, iImei).replace(/^0+/, '');
    const identificador = texto(linha, iId);
    const modelo = texto(linha, iModelo);
    const placa = texto(linha, iPlaca)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    saida.push({
      imei: imei || null,
      identificador: identificador || null,
      modelo,
      tag: /TAG/i.test(modelo),
      placa: placa && placa !== 'ZEROKM' ? placa : null,
      local,
    });
  }
  return saida;
}

function sqlStr(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * SQL que preenche SÓ o que está vazio. O que o técnico já informou por aqui
 * prevalece sobre a Rede — ele viu o carro. Casamento estrito pelo número do
 * equipamento (IMEI para rastreador, série para TAG): placa não serve, porque
 * o aparelho da Rede pode ser outro que não o instalado por nós.
 */
export function montarSqlLocais(locais: LocalRdv[], tenantId: string): string {
  const vazio = "(install_location IS NULL OR btrim(install_location) = '')";
  const linhas: string[] = ['BEGIN;'];
  for (const l of locais) {
    if (l.tag) {
      if (!l.identificador) continue;
      linhas.push(
        `UPDATE tag_links SET install_location = ${sqlStr(l.local)} ` +
          `WHERE tenant_id = ${sqlStr(tenantId)}::uuid AND serial_number = ${sqlStr(l.identificador)} ` +
          `AND deleted_at IS NULL AND ${vazio};`,
      );
    } else {
      if (!l.imei) continue;
      linhas.push(
        `UPDATE devices SET install_location = ${sqlStr(l.local)} ` +
          `WHERE tenant_id = ${sqlStr(tenantId)}::uuid AND ltrim(imei, '0') = ${sqlStr(l.imei)} ` +
          `AND deleted_at IS NULL AND ${vazio};`,
      );
    }
  }
  linhas.push('COMMIT;');
  return linhas.join('\n') + '\n';
}
