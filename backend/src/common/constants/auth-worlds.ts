/**
 * Mapa dos mundos de autenticação do backend.
 *
 * O projeto atende três públicos com três tipos de token que nunca podem
 * cruzar: o time interno (`type: 'user'`), o cliente final (`type:
 * 'associate'`) e o técnico de campo (`type: 'technician'`). Este arquivo é a
 * fonte única consumida pelo `scripts/leak-check.ts`, e o spec ao lado varre
 * os controllers do repositório e falha se alguém criar rota que não esteja
 * classificada aqui — assim rota nova nasce coberta em vez de nascer furada.
 *
 * A chave de classificação é o CAMINHO DO ARQUIVO do controller, relativo a
 * `backend/src/modules/` (com `/`, mesmo no Windows) — não o prefixo de rota.
 * Prefixo não serve de chave porque `@Controller()` sem argumento (prefixo
 * vazio) é ambíguo por construção: dois controllers diferentes podem ter
 * prefixo `''` e ficariam indistinguíveis, ou pior, o extrator de prefixo por
 * regex simplesmente descarta esses controllers e eles somem do mapa sem
 * nenhuma asserção acusar. Isso já aconteceu com `ScoringController` (rotas
 * internas autenticadas) e `LegalController` — ver `auth-worlds.spec.ts`.
 */

/** Painel do time interno. Token `type: 'user'`. */
export const INTERNAL_CONTROLLERS: readonly string[] = [
  'admin/admin.controller.ts',
  'audit/audit.controller.ts',
  'alerts/alerts.controller.ts',
  'assistant/assistant.controller.ts',
  'auth/auth.controller.ts',
  'ble-tags/ble-tags.controller.ts',
  'chips/chips.controller.ts',
  'clients/clients.controller.ts',
  'dashboard/dashboard.controller.ts',
  'devices/devices.controller.ts',
  'sms-commands/sms-commands.controller.ts',
  'geofences/geofences.controller.ts',
  'hinova/hinova.controller.ts',
  'installation-pendings/installation-pendings.controller.ts',
  'maintenance/maintenance.controller.ts',
  'map/map.controller.ts',
  'reports/reports.controller.ts',
  'scoring/scoring.controller.ts',
  'server-info/server-info.controller.ts',
  'stock/stock.controller.ts',
  'technicians/technicians.controller.ts',
  'tenant-settings/tenant-settings.controller.ts',
  'tenants/tenants.controller.ts',
  'traccar/traccar.controller.ts',
  'users/users.controller.ts',
  'vehicles/vehicles.controller.ts',
  'vehicles-analytics/vehicles-analytics.controller.ts',
];

/** App do cliente final. Token `type: 'associate'`. */
export const ASSOCIATE_CONTROLLERS: readonly string[] = [
  'app/app-data.controller.ts',
  'app/associate-auth.controller.ts',
];

/** PWA do técnico de campo. Token `type: 'technician'`. */
export const TECHNICIAN_CONTROLLERS: readonly string[] = [
  'tech/tech-field.controller.ts',
  'tech/tech-auth.controller.ts',
];

/**
 * Sem autenticação por desenho. `health` é sondado pelo Docker e pelo
 * monitoramento — exigir token ali derrubaria o healthcheck do container.
 *
 * `legal/legal.controller.ts` hoje só expõe rotas `@Public()` (política de
 * privacidade, exclusão de dados, diagnóstico de boot do app) — nenhuma exige
 * token. Se alguém acrescentar rota autenticada nesse controller no futuro,
 * ele continua classificado aqui até ser movido explicitamente pra
 * `INTERNAL_CONTROLLERS`; o item de ação é revisar este comentário sempre que
 * `legal.controller.ts` mudar.
 */
export const PUBLIC_CONTROLLERS: readonly string[] = [
  'health/health.controller.ts',
  'legal/legal.controller.ts',
];

/**
 * Gateways WebSocket que atendem MAIS DE UM mundo pelo mesmo socket.
 *
 * Entrar nesta lista é decisão consciente, nunca default: um arquivo aqui
 * PRECISA rotear explicitamente por `payload.type` — escolher o segredo de
 * verificação pelo tipo declarado e mandar cada mundo pra sala dele, com
 * `default` que desconecta. Um gateway não tem guard por rota nem status 403
 * pra avisar que errou: se o roteamento falhar, o cliente errado simplesmente
 * passa a receber o stream de posição em tempo real de quem não é dele.
 *
 * `traccar/traccar.gateway.ts` é o único socket do projeto e é onde painel
 * (`type: 'user'`) e app do cliente (`type: 'associate'`) se encontram. Token
 * de técnico chega até ele — é assinado com o mesmo `jwt.secret` do painel —
 * e é recusado de propósito: o PWA do técnico não consome realtime.
 *
 * Se um gateway novo servir um mundo só, ele NÃO entra aqui — entra na lista
 * do mundo dele.
 */
export const MULTI_WORLD_GATEWAYS: readonly string[] = [
  'traccar/traccar.gateway.ts',
];

export type AuthWorld = 'internal' | 'associate' | 'technician';

export interface LeakProbe {
  world: AuthWorld;
  /** Caminho do controller (relativo a `backend/src/modules/`) que esta sonda cobre. */
  controller: string;
  /** Caminho GET real e existente, que exige autenticação. */
  path: string;
}

/**
 * Controllers com autenticação cujo arquivo não tem nenhum GET utilizável
 * como sonda (só POST/PATCH/DELETE, ou só rotas `@Public()`). Registrado
 * aqui em vez de forçar uma sonda inventada — o comentário em cada item
 * explica o motivo.
 *
 * Todos os controllers autenticados do projeto (varredura de 2026-08-10) têm
 * ao menos um GET real e protegido, então esta lista está vazia por ora.
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
  { world: 'internal', controller: 'admin/admin.controller.ts', path: '/admin/deleted/tenant' },
  { world: 'internal', controller: 'audit/audit.controller.ts', path: '/admin/audit' },
  { world: 'internal', controller: 'alerts/alerts.controller.ts', path: '/alerts' },
  {
    world: 'internal',
    controller: 'assistant/assistant.controller.ts',
    path: '/assistant/conversations',
  },
  { world: 'internal', controller: 'auth/auth.controller.ts', path: '/auth/me' },
  { world: 'internal', controller: 'ble-tags/ble-tags.controller.ts', path: '/ble-tags' },
  { world: 'internal', controller: 'chips/chips.controller.ts', path: '/chips' },
  { world: 'internal', controller: 'clients/clients.controller.ts', path: '/clients' },
  { world: 'internal', controller: 'dashboard/dashboard.controller.ts', path: '/dashboard/overview' },
  { world: 'internal', controller: 'devices/devices.controller.ts', path: '/devices' },
  {
    world: 'internal',
    controller: 'sms-commands/sms-commands.controller.ts',
    path: '/devices/00000000-0000-0000-0000-000000000000/commands',
  },
  { world: 'internal', controller: 'geofences/geofences.controller.ts', path: '/geofences' },
  { world: 'internal', controller: 'hinova/hinova.controller.ts', path: '/hinova/sync/status' },
  {
    world: 'internal',
    controller: 'installation-pendings/installation-pendings.controller.ts',
    path: '/installation-pendings',
  },
  {
    world: 'internal',
    controller: 'maintenance/maintenance.controller.ts',
    path: '/maintenance-plans',
  },
  { world: 'internal', controller: 'map/map.controller.ts', path: '/map/tiles' },
  { world: 'internal', controller: 'reports/reports.controller.ts', path: '/reports/positions' },
  {
    world: 'internal',
    controller: 'scoring/scoring.controller.ts',
    path: '/vehicles/00000000-0000-0000-0000-000000000000/score',
  },
  { world: 'internal', controller: 'scoring/scoring.controller.ts', path: '/scores/ranking' },
  { world: 'internal', controller: 'server-info/server-info.controller.ts', path: '/server/info' },
  { world: 'internal', controller: 'stock/stock.controller.ts', path: '/stock' },
  {
    world: 'internal',
    controller: 'tenant-settings/tenant-settings.controller.ts',
    path: '/settings',
  },
  { world: 'internal', controller: 'technicians/technicians.controller.ts', path: '/technicians' },
  { world: 'internal', controller: 'tenants/tenants.controller.ts', path: '/tenants' },
  { world: 'internal', controller: 'traccar/traccar.controller.ts', path: '/traccar/devices' },
  { world: 'internal', controller: 'users/users.controller.ts', path: '/users' },
  { world: 'internal', controller: 'vehicles/vehicles.controller.ts', path: '/vehicles' },
  {
    world: 'internal',
    controller: 'vehicles-analytics/vehicles-analytics.controller.ts',
    path: '/vehicles/00000000-0000-0000-0000-000000000000/behavior',
  },

  // App do cliente final.
  { world: 'associate', controller: 'app/app-data.controller.ts', path: '/app/vehicles' },
  { world: 'associate', controller: 'app/associate-auth.controller.ts', path: '/app/auth/me' },

  // PWA do técnico de campo.
  { world: 'technician', controller: 'tech/tech-field.controller.ts', path: '/tech/assignments' },
  { world: 'technician', controller: 'tech/tech-auth.controller.ts', path: '/tech/auth/me' },
];
