import type { Role } from '@/types/auth';

/**
 * Telas que podem ser liberadas por usuário. Espelha
 * `backend/src/common/constants/manageable-routes.ts` — mexeu num, mexe no outro.
 */
export const MANAGEABLE_ROUTES = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard' },
  { key: 'mapa', label: 'Mapa / Veículos', path: '/mapa' },
  { key: 'alertas', label: 'Alertas', path: '/alertas' },
  { key: 'relatorios', label: 'Relatórios e ranking', path: '/relatorios' },
  { key: 'manutencao', label: 'Manutenção', path: '/manutencao' },
  { key: 'dispositivos', label: 'Dispositivos', path: '/dispositivos' },
  { key: 'chips', label: 'Chips', path: '/chips' },
  { key: 'estoque', label: 'Estoque', path: '/estoque' },
  { key: 'clientes', label: 'Clientes ativos', path: '/clientes' },
  { key: 'pendencias', label: 'Pendentes de instalação', path: '/pendencias' },
  { key: 'rotas', label: 'Rota inteligente', path: '/rotas' },
  { key: 'tecnicos', label: 'Técnicos', path: '/tecnicos' },
  { key: 'geofencing', label: 'Cercas virtuais', path: '/geofencing' },
  { key: 'etiquetas-ble', label: 'Etiquetas BLE', path: '/etiquetas-ble' },
  { key: 'usuarios', label: 'Usuários e acessos', path: '/usuarios' },
  { key: 'configuracoes', label: 'Configurações', path: '/configuracoes' },
] as const;

export type ManageableRouteKey = (typeof MANAGEABLE_ROUTES)[number]['key'];

/** Telas que cada perfil pode enxergar antes de qualquer customização. */
export const DEFAULT_ROUTES_BY_ROLE: Record<Role, ManageableRouteKey[]> = {
  SUPER_ADMIN: MANAGEABLE_ROUTES.map((r) => r.key),
  ADMIN: MANAGEABLE_ROUTES.map((r) => r.key),
  OPERATOR: [
    'dashboard',
    'mapa',
    'alertas',
    'relatorios',
    'manutencao',
    'dispositivos',
    'chips',
    'estoque',
    'clientes',
    'pendencias',
    'rotas',
    'tecnicos',
    'geofencing',
    'etiquetas-ble',
    'configuracoes',
  ],
  VIEWER: [
    'dashboard',
    'mapa',
    'alertas',
    'relatorios',
    'clientes',
    'configuracoes',
  ],
  CLIENT: ['mapa', 'alertas', 'configuracoes'],
};

/** Só Admin e Super Admin gerenciam acessos. */
export const ROLES_THAT_MANAGE_USERS: Role[] = ['SUPER_ADMIN', 'ADMIN'];

/**
 * Bloqueio/desbloqueio de veículo corta o motor — só Super Admin.
 * Espelha `@Roles(Role.SUPER_ADMIN)` em `vehicles.controller.ts`; mexeu num,
 * mexe no outro. Cliente final (app) nunca enxerga esse botão.
 */
export function canBlockVehicle(role: Role | undefined): boolean {
  return role === 'SUPER_ADMIN';
}

/**
 * Decide se o usuário pode abrir uma tela.
 * `allowedRoutes` vazio mantém o comportamento antigo: vale só o perfil.
 */
export function canAccessRoute(
  route: ManageableRouteKey,
  role: Role | undefined,
  allowedRoutes: string[] | undefined,
): boolean {
  if (!role) return false;
  if (role === 'SUPER_ADMIN') return true;
  if (route === 'usuarios' && !ROLES_THAT_MANAGE_USERS.includes(role)) {
    return false;
  }
  if (!DEFAULT_ROUTES_BY_ROLE[role]?.includes(route)) return false;
  if (!allowedRoutes || allowedRoutes.length === 0) return true;
  return allowedRoutes.includes(route);
}

/** Telas que compartilham a chave de outra (detalhe de veículo mora no mapa). */
const PATH_ALIASES: Array<[string, ManageableRouteKey]> = [
  ['/veiculos', 'mapa'],
  ['/relatorios', 'relatorios'],
];

/** Descobre qual tela um pathname representa. `null` = rota não controlada. */
export function routeKeyForPath(pathname: string): ManageableRouteKey | null {
  for (const [prefix, key] of PATH_ALIASES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return key;
  }
  const match = MANAGEABLE_ROUTES.find(
    (r) => pathname === r.path || pathname.startsWith(`${r.path}/`),
  );
  return match ? match.key : null;
}

/** Primeira tela que o usuário pode abrir — destino do redirect ao barrar. */
export function firstAllowedPath(
  role: Role | undefined,
  allowedRoutes: string[] | undefined,
): string {
  const first = MANAGEABLE_ROUTES.find((r) =>
    canAccessRoute(r.key, role, allowedRoutes),
  );
  return first?.path ?? '/mapa';
}

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrador',
  OPERATOR: 'Operador',
  VIEWER: 'Visualizador',
  CLIENT: 'Cliente',
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  SUPER_ADMIN: 'Acesso total, inclusive a outras empresas.',
  ADMIN: 'Faz tudo dentro da empresa, inclusive criar acessos.',
  OPERATOR: 'Opera o dia a dia: rastreia, instala, trata alertas.',
  VIEWER: 'Só consulta. Não altera nada.',
  CLIENT: 'Dono do veículo. Vê apenas os carros dele.',
};
