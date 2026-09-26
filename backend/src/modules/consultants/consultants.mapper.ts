/**
 * Conversão do usuário do painel do Power CRM para a linha de `consultants`.
 *
 * Endereço não existe no Power: conferido em 17/09/2026 nos dois endpoints de
 * usuário (`userListFilter`, 23 campos, e `fetchUserToEdit`, 57). Por isso a
 * ficha do consultor não tem endereço — não é esquecimento.
 */

/** Um item de `content` em POST /company/userListFilter (formato real, 17/09/2026). */
export interface UsuarioPower {
  id: number;
  name: string | null;
  fullName: string | null;
  email: string | null;
  /** CPF (ou CNPJ) formatado. 19 dos 4.225 usuários vêm sem. */
  registration: string | null;
  /** 1 Administrador Master · 3 Vendedor · 4 Consultor · 5 Administrador de Cooperativas */
  office: number | null;
  officeString: string | null;
  branchString: string | null;
  cooperativeString: string | null;
  active: boolean;
  /** Nome de TRATAMENTO de quem chamou (não o id) — só serve para exibir. */
  responsibleUser: string | null;
  statusString: string | null;
  isLeader: boolean | null;
  hinovaPayId: unknown;
  userId: number | null;
  companyId: number | null;
  companyUserPhone: string | null;
  companyUserMobile: string | null;
  /** "dd/MM/yyyy HH:mm", horário de Brasília; string vazia quando não há. */
  createdAt: string | null;
  lastAccess: string | null;
  blockedAt: string | null;
  groupPermission: string | null;
  leader: boolean | null;
}

export interface LinhaConsultor {
  tenantId: string;
  powerId: number;
  name: string;
  nickname: string | null;
  email: string | null;
  document: string | null;
  phone: string | null;
  mobile: string | null;
  office: number | null;
  officeLabel: string | null;
  branch: string | null;
  cooperative: string | null;
  permissionGroup: string | null;
  managerName: string | null;
  active: boolean;
  statusLabel: string | null;
  powerCreatedAt: Date | null;
  lastAccessAt: Date | null;
  blockedAt: Date | null;
}

const digitos = (v: string | null | undefined): string | null => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d ? d : null;
};

const texto = (v: string | null | undefined): string | null => {
  const t = String(v ?? '').trim();
  return t ? t : null;
};

/** O painel do Power mostra horário de Brasília (UTC−3, sem horário de verão desde 2019). */
export function dataDoPower(bruto: string | null | undefined): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/.exec(String(bruto ?? '').trim());
  if (!m) return null;
  const [, dd, mm, aaaa, hh = '00', mi = '00'] = m;
  const data = new Date(Date.UTC(+aaaa, +mm - 1, +dd, +hh + 3, +mi));
  // 31/02 viraria 03/03 em silêncio — data que não existe é dado ruim, não data.
  const local = new Date(data.getTime() - 3 * 3600_000);
  if (local.getUTCDate() !== +dd || local.getUTCMonth() !== +mm - 1) return null;
  return data;
}

export function paraLinha(u: UsuarioPower, tenantId: string): LinhaConsultor {
  const nickname = texto(u.name);
  return {
    tenantId,
    powerId: u.id,
    name: texto(u.fullName) ?? nickname ?? `Usuário ${u.id}`,
    nickname,
    email: texto(u.email),
    document: digitos(u.registration),
    phone: digitos(u.companyUserPhone),
    mobile: digitos(u.companyUserMobile),
    office: u.office ?? null,
    officeLabel: texto(u.officeString),
    branch: texto(u.branchString),
    cooperative: texto(u.cooperativeString),
    permissionGroup: texto(u.groupPermission),
    managerName: texto(u.responsibleUser),
    active: Boolean(u.active),
    statusLabel: texto(u.statusString),
    powerCreatedAt: dataDoPower(u.createdAt),
    lastAccessAt: dataDoPower(u.lastAccess),
    blockedAt: dataDoPower(u.blockedAt),
  };
}

/**
 * Só marca como removido do Power quem sumiu de uma coleta INTEIRA.
 *
 * Se o Power cair na página 3 de 5, os 2 mil que não vieram não saíram da
 * empresa — apagar seria esvaziar a aba por causa de uma oscilação.
 */
export function coletaCompleta(coletados: number, anunciados: number): boolean {
  return anunciados > 0 && coletados >= anunciados;
}
