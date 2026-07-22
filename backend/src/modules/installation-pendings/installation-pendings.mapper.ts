import type {
  HinovaRawVehicle,
  HinovaRawAssociate,
} from '../hinova/hinova.interface';
import type { PendingType } from './installation-pendings.types';

/**
 * Tradução da linha crua do SGA para a linha do espelho local.
 * Puro de propósito: é a regra que decide quem entra na fila, e ela precisa ser
 * testável sem banco nem rede.
 */

/**
 * `codigo_tipo_adesao` → tipo interno. Só estes dois são pendência.
 * Lista completa em GET /tipo-adesao/listar/todos (verificada em 2026-07-22):
 * 1 pendente rastreador · 2 instalado · 3 pendente retirada · 4 retirado ·
 * 5 não precisa · 6 perdido · 7 em evento · 8 rastreador+tag · 9 só tag ·
 * 10 pendente tag.
 */
export const TIPO_ADESAO_PENDENTE: Record<string, PendingType> = {
  '1': 'TRACKER',
  '10': 'TAG',
};

export interface PendingRowData {
  hinovaVehicleCode: string;
  plate: string;
  pendingType: PendingType;
  associateName: string;
  associateCode: string;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  brandModel: string;
  vehicleType: string | null;
  city: string | null;
  neighborhood: string | null;
  protectedValue: number;
  contractDate: Date;
  evaluationTable: string | null;
  consultantName: string | null;
  tenantId: string;
}

export function ehPendencia(v: HinovaRawVehicle): boolean {
  return TIPO_ADESAO_PENDENTE[String(v.codigo_tipo_adesao)] !== undefined;
}

/** `data_contrato` vem como "2026-05-04T00:00:00-0300"; só a data importa. */
export function paraData(valor?: string): Date | null {
  const iso = String(valor ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const data = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(data.getTime()) ? null : data;
}

/**
 * O SGA guarda placeholders quando o cliente não deu telefone — linhas como
 * "21 99999-9999" e "99 9999-99999" são lixo, não contato. Descarta qualquer
 * número cujo corpo (sem DDD) seja só o dígito 9 repetido.
 */
export function montarTelefone(v: HinovaRawVehicle): string | null {
  const candidatos: Array<[unknown, unknown]> = [
    [v.ddd_celular, v.telefone_celular],
    [v.ddd, v.telefone],
  ];

  for (const [ddd, numero] of candidatos) {
    const corpo = String(numero ?? '').replace(/\D/g, '');
    if (!corpo || /^9+$/.test(corpo)) continue;
    const completo = [ddd, numero].filter(Boolean).join(' ').trim();
    if (completo) return completo;
  }
  return null;
}

/**
 * Monta a linha do espelho. Retorna null quando falta o mínimo (código, placa
 * ou data de contrato válida) — linha incompleta não entra na fila.
 */
export function paraLinha(
  v: HinovaRawVehicle,
  enderecos: Map<string, HinovaRawAssociate>,
  tenantId: string,
): PendingRowData | null {
  const pendingType = TIPO_ADESAO_PENDENTE[String(v.codigo_tipo_adesao)];
  const contractDate = paraData(v.data_contrato);
  if (!pendingType || !contractDate || !v.codigo_veiculo || !v.placa) return null;

  const endereco = enderecos.get(String(v.codigo_associado));

  return {
    hinovaVehicleCode: String(v.codigo_veiculo),
    plate: String(v.placa).toUpperCase(),
    pendingType,
    associateName: v.nome_associado ?? '',
    associateCode: String(v.codigo_associado ?? ''),
    cpf: v.cpf_associado ?? null,
    phone: montarTelefone(v),
    email: v.email || null,
    brandModel: `${v.marca ?? ''} ${v.modelo ?? ''}`.trim(),
    vehicleType: v.tipo ?? null,
    city: endereco?.cidade ?? null,
    neighborhood: endereco?.bairro ?? null,
    protectedValue: Number(v.valor_fipe_protegido ?? v.valor_fipe ?? 0),
    contractDate,
    evaluationTable: v.codigo_tabela_avaliacao ?? null,
    consultantName: v.nome_voluntario ?? null,
    tenantId,
  };
}

/**
 * Fila completa a partir das listagens cruas.
 *
 * Espelha os três filtros que a operação marca à mão no relatório do SGA:
 * pendência de rastreador/TAG, veículo ativo (a listagem já vem só com ativos)
 * e **cliente ativo** — quem não está no índice de associados ativos cai fora.
 */
export function montarFila(
  veiculos: HinovaRawVehicle[],
  associados: HinovaRawAssociate[],
  tenantId: string,
): PendingRowData[] {
  const enderecos = new Map(
    associados.map((a) => [String(a.codigo_associado), a]),
  );

  return veiculos
    .filter(ehPendencia)
    .filter((v) => enderecos.has(String(v.codigo_associado)))
    .map((v) => paraLinha(v, enderecos, tenantId))
    .filter((linha): linha is PendingRowData => linha !== null);
}
