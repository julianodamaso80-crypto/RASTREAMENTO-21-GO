import { Prisma, Role } from '.prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { decidirTipoVeiculo } from '../hinova/tipo-veiculo';
import { assessComms } from './asset-comms';

/**
 * TAG em Clientes Ativos — spec 2026-09-16 §9.
 *
 * A TAG é segredo interno: só estes perfis recebem qualquer campo dela. O
 * associado (app) nem passa por este controller, e o perfil CLIENT não recebe
 * nada — a lista dele continua idêntica à de antes.
 */
export const PERFIS_QUE_VEEM_TAG: readonly Role[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.OPERATOR,
  Role.VIEWER,
];

export function podeVerTag(role: Role | string | undefined): boolean {
  return PERFIS_QUE_VEEM_TAG.includes(role as Role);
}

export interface VinculoTag {
  id: string;
  serialNumber: string;
  plate: string;
  chassi: string | null;
  hinovaVehicleCode: string | null;
  associateName: string | null;
  associateCpf: string | null;
  origin: string;
  verdict: string;
  checkedAt: Date;
}

/**
 * Quando o vínculo aparece para o time — regra do dono (21/09/2026): associado
 * ATIVO no SGA + TAG vinculada + TAG rastreável = cliente ativo nosso.
 * - vindo da Rede: rastreável = já temos posição dela pela nossa coleta (ou a
 *   localização foi provada contra o rastreador do carro);
 * - vinculado à mão no Estoque: a pessoa que vinculou é a fonte.
 * Nos dois casos, nunca se a posição contradisser o carro (DIVERGENTE).
 */
export function vinculoAparece(
  v: Pick<VinculoTag, 'origin' | 'verdict'>,
  situacaoSgaAtual: string | null,
  rastreavel: boolean,
): boolean {
  if (situacaoSgaAtual !== 'ATIVO') return false;
  if (v.verdict === 'DIVERGENTE') return false;
  if (v.origin === 'ESTOQUE') return true;
  return v.verdict === 'CONFIRMADA' || rastreavel;
}

/** Seriais que têm ao menos uma posição da nossa coleta. */
async function seriaisComPosicao(
  prisma: PrismaService,
  tenantId: string,
  seriais: string[],
): Promise<Set<string>> {
  if (seriais.length === 0) return new Set();
  const linhas = await prisma.$queryRaw<Array<{ serial_number: string }>>(Prisma.sql`
    SELECT DISTINCT serial_number FROM tag_positions
     WHERE tenant_id = ${tenantId}::uuid AND serial_number IN (${Prisma.join(seriais)})`);
  return new Set(linhas.map((l) => l.serial_number));
}

/** Veículos (rastreador) primeiro, depois quem só tem TAG, numa paginação só. */
export function fatiaCombinada(
  totalVeiculos: number,
  totalSoTag: number,
  page: number,
  perPage: number,
) {
  const inicio = (page - 1) * perPage;
  const fim = inicio + perPage;
  const skipVeiculos = Math.min(inicio, totalVeiculos);
  const takeVeiculos = Math.max(0, Math.min(fim, totalVeiculos) - skipVeiculos);
  const inicioTag = Math.max(0, inicio - totalVeiculos);
  const fimTag = Math.min(totalSoTag, Math.max(0, fim - totalVeiculos));
  return { skipVeiculos, takeVeiculos, inicioTag, fimTag };
}

function soAlfanumerico(s: string | null | undefined) {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Nome como o operador digita: sem acento, minúsculo, um espaço só. O cadastro
 * tem "SÉRGIO", "ÂNGELO" e espaço dobrado; quem busca digita "sergio".
 */
export function normalizarNome(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function casaBusca(
  item: {
    plate: string;
    chassi: string | null;
    associateName: string | null;
    associateCpf: string | null;
    serialNumber: string;
    /** Outras TAGs do mesmo carro: o card é um só, a busca acha por qualquer uma. */
    outrosSeriais?: string[];
  },
  termo: string | undefined,
): boolean {
  const t = termo?.trim();
  if (!t) return true;
  const alfa = soAlfanumerico(t);
  const digitos = t.replace(/\D/g, '');
  if (alfa && (soAlfanumerico(item.plate).includes(alfa) || soAlfanumerico(item.chassi).includes(alfa))) {
    return true;
  }
  const nome = normalizarNome(t);
  if (nome && normalizarNome(item.associateName).includes(nome)) return true;
  const seriais = [item.serialNumber, ...(item.outrosSeriais ?? [])];
  // Série com letra ("K306491") casa pelo termo inteiro; placa com letra nunca
  // está contida numa série só de dígitos, então a regra abaixo continua valendo.
  if (/[A-Za-z]/.test(t) && alfa && seriais.some((sn) => soAlfanumerico(sn).includes(alfa))) {
    return true;
  }
  // Mesma regra do núcleo de busca (termo-busca.ts): termo com letra nunca vira
  // busca numérica — "LMX4B84" viraria "484" e casaria com metade das TAGs.
  if (/[A-Za-z]/.test(t) || digitos.length < 3) return false;
  if (digitos &&((item.associateCpf ?? '').includes(digitos) || seriais.some((sn) => sn.includes(digitos)))) {
    return true;
  }
  return false;
}

export interface PosicaoTag {
  lat: number;
  lng: number;
  accuracyM: number | null;
  seenAt: Date;
}

/** Última posição de cada TAG, numa consulta (índice tenant+serial+seen_at). */
export async function ultimasPosicoes(
  prisma: PrismaService,
  tenantId: string,
  seriais: string[],
): Promise<Map<string, PosicaoTag>> {
  if (seriais.length === 0) return new Map();
  const linhas = await prisma.$queryRaw<
    Array<{ serial_number: string; latitude: number; longitude: number; accuracy_m: number | null; seen_at: Date }>
  >(Prisma.sql`
    SELECT DISTINCT ON (serial_number) serial_number, latitude, longitude, accuracy_m, seen_at
      FROM tag_positions
     WHERE tenant_id = ${tenantId}::uuid AND serial_number IN (${Prisma.join(seriais)})
     ORDER BY serial_number, seen_at DESC`);
  return new Map(
    linhas.map((l) => [
      l.serial_number,
      { lat: l.latitude, lng: l.longitude, accuracyM: l.accuracy_m, seenAt: l.seen_at },
    ]),
  );
}

export function resumoTag(v: VinculoTag, pos: PosicaoTag | undefined) {
  return {
    serialNumber: v.serialNumber,
    origin: v.origin,
    verdict: v.verdict,
    lastSeenAt: pos?.seenAt ?? null,
    lat: pos?.lat ?? null,
    lng: pos?.lng ?? null,
    accuracyM: pos?.accuracyM ?? null,
  };
}

type SgaLinha = {
  plate: string;
  chassi: string | null;
  hinovaVehicleCode: string;
  associateName: string;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  brandModel: string;
  situationLabel: string;
  vehicleType: string | null;
};

/**
 * Vínculos vivos do tenant que aparecem na tela, cada um com a linha atual do
 * espelho do SGA (situação, contato, modelo). Casamento pelo código do veículo
 * no SGA; sem ele, pela placa ou pelo chassi (0 km tem "Zero KM" na placa).
 */
export async function vinculosVisiveis(prisma: PrismaService, tenantId: string) {
  return (await vinculosDaTela(prisma, tenantId)).visiveis;
}

/**
 * `visiveis`: a lista da tela (régua do dono). `ocultos`: TAG de carro ATIVO que
 * a régua esconde (sem posição ainda ou divergente) — fora da lista, mas a busca
 * tem que achar: nenhuma TAG de cliente ativo pode ficar impossível de localizar.
 */
export async function vinculosDaTela(prisma: PrismaService, tenantId: string) {
  const vinculos: VinculoTag[] = await prisma.tagLink.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true,
      serialNumber: true,
      plate: true,
      chassi: true,
      hinovaVehicleCode: true,
      associateName: true,
      associateCpf: true,
      origin: true,
      verdict: true,
      checkedAt: true,
    },
  });
  if (vinculos.length === 0) return { visiveis: [], ocultos: [] };

  const codigos = vinculos.map((v) => v.hinovaVehicleCode).filter((c): c is string => !!c);
  const chassis = vinculos.map((v) => v.chassi).filter((c): c is string => !!c);
  const placas = vinculos.map((v) => v.plate);
  const sga: SgaLinha[] = await prisma.sgaVehicle.findMany({
    where: {
      tenantId,
      OR: [
        { hinovaVehicleCode: { in: codigos } },
        { chassi: { in: chassis } },
        { plate: { in: placas } },
      ],
    },
    select: {
      plate: true,
      chassi: true,
      hinovaVehicleCode: true,
      associateName: true,
      cpf: true,
      phone: true,
      email: true,
      brandModel: true,
      situationLabel: true,
      vehicleType: true,
    },
  });
  const porCodigo = new Map(sga.map((s) => [s.hinovaVehicleCode, s]));
  const porChassi = new Map(sga.filter((s) => s.chassi).map((s) => [s.chassi as string, s]));
  const porPlaca = new Map(sga.map((s) => [s.plate, s]));
  const comPosicao = await seriaisComPosicao(
    prisma,
    tenantId,
    vinculos.map((v) => v.serialNumber),
  );

  const itens = vinculos.map((v) => {
    const linha =
      (v.hinovaVehicleCode && porCodigo.get(v.hinovaVehicleCode)) ||
      (v.chassi && porChassi.get(v.chassi)) ||
      porPlaca.get(v.plate) ||
      null;
    return { vinculo: v, sga: linha };
  });
  return separarVinculos(itens, comPosicao);
}

type ItemVinculo = {
  vinculo: Pick<VinculoTag, 'serialNumber' | 'plate' | 'origin' | 'verdict'>;
  sga: { hinovaVehicleCode: string; situationLabel: string } | null;
};

const chaveDoVeiculo = (x: ItemVinculo) => x.sga?.hinovaVehicleCode ?? `placa:${x.vinculo.plate}`;

/**
 * Toda TAG de carro ATIVO no SGA cai em exatamente um card: a visível pela
 * régua, ou — se o carro já tem card — vira número extra dele, ou fica oculta.
 */
export function separarVinculos<T extends ItemVinculo>(itens: T[], comPosicao: Set<string>) {
  const aparecem = new Set(
    itens.filter((x) =>
      vinculoAparece(x.vinculo, x.sga?.situationLabel ?? null, comPosicao.has(x.vinculo.serialNumber)),
    ),
  );
  const visiveis = umPorVeiculo([...aparecem], comPosicao);
  const cardDoVeiculo = new Map(visiveis.map((x) => [chaveDoVeiculo(x), x]));

  const semCard: T[] = [];
  for (const x of itens) {
    if (aparecem.has(x) || x.sga?.situationLabel !== 'ATIVO') continue;
    const card = cardDoVeiculo.get(chaveDoVeiculo(x));
    if (card) card.outrosSeriais.push(x.vinculo.serialNumber);
    else semCard.push(x);
  }
  return { visiveis, ocultos: umPorVeiculo(semCard, comPosicao) };
}

/**
 * Um card por veículo. A Rede tem carro com duas TAGs (14 em 21/09/2026);
 * fica a que tem posição, e no empate a primeira.
 */
export function umPorVeiculo<
  T extends { vinculo: { serialNumber: string; plate: string }; sga: { hinovaVehicleCode: string } | null },
>(itens: T[], comPosicao: Set<string>): Array<T & { outrosSeriais: string[] }> {
  const porVeiculo = new Map<string, { card: T; todos: string[] }>();
  for (const x of itens) {
    const chave = x.sga?.hinovaVehicleCode ?? `placa:${x.vinculo.plate}`;
    const atual = porVeiculo.get(chave);
    if (!atual) {
      porVeiculo.set(chave, { card: x, todos: [x.vinculo.serialNumber] });
      continue;
    }
    atual.todos.push(x.vinculo.serialNumber);
    if (!comPosicao.has(atual.card.vinculo.serialNumber) && comPosicao.has(x.vinculo.serialNumber)) {
      atual.card = x;
    }
  }
  // As TAGs que não viraram o card ficam como número extra dele: a busca acha.
  return [...porVeiculo.values()].map(({ card, todos }) => ({
    ...card,
    outrosSeriais: todos.filter((sn) => sn !== card.vinculo.serialNumber),
  }));
}

/**
 * Separa quem é "só TAG": vínculo cuja placa NÃO tem veículo com rastreador
 * nosso. O carro que tem rastreador carrega a TAG como selo, nunca como um
 * segundo card — nem em Clientes Ativos, nem no Mapa. Os dois usam esta mesma
 * função para que o número de TAGs das duas telas seja um só.
 */
export async function separarSoTag<T extends { vinculo: { plate: string } }>(
  prisma: PrismaService,
  tenantId: string,
  itens: T[],
): Promise<{ apenasTag: T[]; placasComVeiculo: Set<string> }> {
  const placasComVeiculo = new Set(
    (
      await prisma.vehicle.findMany({
        where: { tenantId, deletedAt: null, plate: { in: itens.map((x) => x.vinculo.plate) } },
        select: { plate: true },
      })
    ).map((v) => v.plate),
  );
  return {
    apenasTag: itens.filter((x) => !placasComVeiculo.has(x.vinculo.plate)),
    placasComVeiculo,
  };
}

/**
 * Ponto de TAG no Mapa. Só o que a TAG sabe dizer: onde foi vista, quando e
 * com que precisão. Nada de ignição, velocidade ou bloqueio — ela não mede
 * nada disso, e a posição é sempre passado (a TAG só é vista quando um iPhone
 * passa perto).
 */
export function tagNoMapa(
  x: { vinculo: VinculoTag; sga: SgaLinha | null },
  pos: PosicaoTag | undefined,
) {
  const card = ativoSoTag(x, pos);
  return {
    id: card.id,
    serialNumber: x.vinculo.serialNumber,
    plate: card.plate,
    associateName: card.associate.name,
    model: card.model,
    vehicleType: card.vehicleType,
    latitude: pos?.lat ?? null,
    longitude: pos?.lng ?? null,
    accuracyM: pos?.accuracyM ?? null,
    seenAt: pos?.seenAt ?? null,
  };
}

/** Card de quem só tem TAG (nenhum rastreador nosso no veículo). */
export function ativoSoTag(
  x: { vinculo: VinculoTag; sga: SgaLinha | null },
  pos: PosicaoTag | undefined,
) {
  const { vinculo: v, sga } = x;
  const { tipo } = decidirTipoVeiculo({ tipoSga: sga?.vehicleType, chassi: v.chassi });
  return {
    id: `tag-${v.id}`,
    plate: v.plate,
    brand: null,
    model: sga?.brandModel ?? null,
    vehicleType: tipo ?? 'CAR',
    chassi: v.chassi,
    status: 'ACTIVE',
    createdAt: v.checkedAt,
    associate: {
      id: '',
      name: sga?.associateName ?? v.associateName ?? 'Associado (SGA)',
      cpf: sga?.cpf ?? v.associateCpf ?? '',
      phone: sga?.phone ?? null,
      email: sga?.email ?? null,
    },
    device: null,
    lastFixTime: null,
    comms: assessComms(null, null),
    financialStatus: null,
    financialStatusAt: null,
    appAccessBlocked: false,
    sga: { code: v.hinovaVehicleCode, statusLabel: sga?.situationLabel ?? null },
    soTag: true,
    tag: resumoTag(v, pos),
  };
}
