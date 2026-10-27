import { PrismaService } from '../prisma/prisma.service';
import { normalizeDoc } from './documento';

/**
 * Situações do SGA (espelho `sga_vehicles.situation_code`) que tiram o acesso
 * ao app: 2 INATIVO · 4 INADIMPLENTE. Quem não está no espelho não entra aqui —
 * "não consultado" não é "inativo".
 */
export const SITUACOES_SGA_SEM_ACESSO = ['2', '4'];

/** Device já passado da instalação; PENDING_INSTALL e DEACTIVATED não dão acesso. */
export const STATUS_DEVICE_COM_ACESSO = [
  'INSTALLED',
  'CONFIGURING',
  'ONLINE',
  'OFFLINE',
  'MAINTENANCE',
] as const;

/** Allowlist de testadores (`APP_ASSOCIATE_ALLOWLIST`): entra sem rastreador. */
export function cpfNaAllowlist(cpf: string): boolean {
  const raw = process.env.APP_ASSOCIATE_ALLOWLIST?.trim();
  if (!raw) return false;
  const alvo = normalizeDoc(cpf);
  return raw
    .split(',')
    .map((c) => normalizeDoc(c))
    .some((c) => c.length > 0 && c === alvo);
}

/**
 * Placas do associado que podem usar o app: rastreador instalado, acesso não
 * cortado à mão no painel e situação no SGA diferente de INATIVO/INADIMPLENTE.
 */
export async function placasComAcesso(
  prisma: PrismaService,
  associateId: string,
): Promise<string[]> {
  const veiculos = await prisma.vehicle.findMany({
    where: {
      associateId,
      deletedAt: null,
      appAccessBlocked: false,
      device: { status: { in: [...STATUS_DEVICE_COM_ACESSO] as any } },
    },
    select: { plate: true, tenantId: true },
  });
  const barradas = await placasBarradasPeloSga(prisma, veiculos);
  return veiculos
    .filter((v) => !barradas.has(`${v.tenantId}:${v.plate}`))
    .map((v) => v.plate);
}

/** Chaves `tenantId:placa` dos veículos que o SGA marca como inativo/inadimplente. */
export async function placasBarradasPeloSga(
  prisma: PrismaService,
  veiculos: { plate: string; tenantId: string }[],
): Promise<Set<string>> {
  if (veiculos.length === 0) return new Set();
  const barradas = await prisma.sgaVehicle.findMany({
    where: {
      plate: { in: veiculos.map((v) => v.plate) },
      tenantId: { in: [...new Set(veiculos.map((v) => v.tenantId))] },
      situationCode: { in: SITUACOES_SGA_SEM_ACESSO },
    },
    select: { plate: true, tenantId: true },
  });
  return new Set(barradas.map((b) => `${b.tenantId}:${b.plate}`));
}

export async function associadoPodeUsarApp(
  prisma: PrismaService,
  associate: { id: string; cpf: string | null },
): Promise<boolean> {
  if (associate.cpf && cpfNaAllowlist(associate.cpf)) return true;
  return (await placasComAcesso(prisma, associate.id)).length > 0;
}
