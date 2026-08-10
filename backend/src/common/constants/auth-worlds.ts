/**
 * Mapa dos mundos de autenticação do backend.
 *
 * O projeto atende três públicos com três tipos de token que nunca podem
 * cruzar: o time interno (`type: 'user'`), o cliente final (`type:
 * 'associate'`) e o técnico de campo (`type: 'technician'`). Este arquivo é a
 * fonte única consumida pelo `scripts/leak-check.ts`, e o spec ao lado varre
 * os controllers do repositório e falha se alguém criar rota que não esteja
 * classificada aqui — assim rota nova nasce coberta em vez de nascer furada.
 */

/** Painel do time interno. Token `type: 'user'`. */
export const INTERNAL_ROUTE_PREFIXES: readonly string[] = [
  'admin',
  'admin/audit',
  'alerts',
  'assistant',
  'auth',
  'ble-tags',
  'chips',
  'clients',
  'dashboard',
  'devices',
  'devices/:deviceId/commands',
  'geofences',
  'hinova',
  'installation-pendings',
  'maintenance-plans',
  'map',
  'reports',
  'server',
  'settings',
  'stock',
  'technicians',
  'tenants',
  'traccar',
  'users',
  'vehicles',
];

/** App do cliente final. Token `type: 'associate'`. */
export const ASSOCIATE_ROUTE_PREFIXES: readonly string[] = ['app', 'app/auth'];

/** PWA do técnico de campo. Token `type: 'technician'`. */
export const TECHNICIAN_ROUTE_PREFIXES: readonly string[] = [
  'tech',
  'tech/auth',
];

/**
 * Sem autenticação por desenho. `health` é sondado pelo Docker e pelo
 * monitoramento — exigir token ali derrubaria o healthcheck do container.
 */
export const PUBLIC_ROUTE_PREFIXES: readonly string[] = ['health'];

export type AuthWorld = 'internal' | 'associate' | 'technician';

export interface LeakProbe {
  world: AuthWorld;
  /** Prefixo do controller que esta sonda cobre. */
  prefix: string;
  /** Caminho GET real e existente, que exige autenticação. */
  path: string;
}

/**
 * Prefixos com autenticação cujo controller não tem nenhum GET utilizável
 * como sonda (só POST/PATCH/DELETE, ou só rotas `@Public()`). Registrado
 * aqui em vez de forçar uma sonda inventada — o comentário em cada item
 * explica o motivo.
 *
 * Todos os prefixos autenticados do projeto (varredura de 2026-08-10) têm ao
 * menos um GET real e protegido, então esta lista está vazia por ora.
 */
export const PROBES_SEM_GET: readonly string[] = [];

/**
 * Caminhos concretos que o `leak-check` dispara. Precisam ser rotas GET que
 * EXISTEM: uma rota inexistente devolve 404 antes de o guard rodar, e 404 de
 * rota inexistente pareceria "protegido" sem nada ter sido protegido.
 *
 * `app` e `tech` são marcados `@Public()` no controller pra pular o
 * `JwtAuthGuard` global (que só entende token de painel), mas cada um usa seu
 * próprio guard (`AssociateJwtGuard` / `TechnicianJwtGuard`) que ainda exige
 * token válido do respectivo mundo — por isso servem de sonda.
 */
export const LEAK_PROBES: readonly LeakProbe[] = [
  // Painel do time interno.
  { world: 'internal', prefix: 'admin', path: '/admin/deleted/tenant' },
  { world: 'internal', prefix: 'admin/audit', path: '/admin/audit' },
  { world: 'internal', prefix: 'alerts', path: '/alerts' },
  { world: 'internal', prefix: 'assistant', path: '/assistant/conversations' },
  { world: 'internal', prefix: 'auth', path: '/auth/me' },
  { world: 'internal', prefix: 'ble-tags', path: '/ble-tags' },
  { world: 'internal', prefix: 'chips', path: '/chips' },
  { world: 'internal', prefix: 'clients', path: '/clients' },
  { world: 'internal', prefix: 'dashboard', path: '/dashboard/overview' },
  { world: 'internal', prefix: 'devices', path: '/devices' },
  {
    world: 'internal',
    prefix: 'devices/:deviceId/commands',
    path: '/devices/00000000-0000-0000-0000-000000000000/commands',
  },
  { world: 'internal', prefix: 'geofences', path: '/geofences' },
  { world: 'internal', prefix: 'hinova', path: '/hinova/sync/status' },
  {
    world: 'internal',
    prefix: 'installation-pendings',
    path: '/installation-pendings',
  },
  { world: 'internal', prefix: 'maintenance-plans', path: '/maintenance-plans' },
  { world: 'internal', prefix: 'map', path: '/map/tiles' },
  { world: 'internal', prefix: 'reports', path: '/reports/positions' },
  { world: 'internal', prefix: 'server', path: '/server/info' },
  { world: 'internal', prefix: 'settings', path: '/settings' },
  { world: 'internal', prefix: 'stock', path: '/stock' },
  { world: 'internal', prefix: 'technicians', path: '/technicians' },
  { world: 'internal', prefix: 'tenants', path: '/tenants' },
  { world: 'internal', prefix: 'traccar', path: '/traccar/devices' },
  { world: 'internal', prefix: 'users', path: '/users' },
  { world: 'internal', prefix: 'vehicles', path: '/vehicles' },

  // App do cliente final.
  { world: 'associate', prefix: 'app', path: '/app/vehicles' },
  { world: 'associate', prefix: 'app/auth', path: '/app/auth/me' },

  // PWA do técnico de campo.
  { world: 'technician', prefix: 'tech', path: '/tech/assignments' },
  { world: 'technician', prefix: 'tech/auth', path: '/tech/auth/me' },
];
