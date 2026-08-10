/**
 * Catálogo das telas que podem ser liberadas por usuário.
 *
 * A chave é o que fica gravado em `User.allowedRoutes` e o que o dashboard usa
 * pra montar o menu. Lista vazia no usuário = todas as telas que o `role` já
 * permitia antes desta feature existir.
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

export const MANAGEABLE_ROUTE_KEYS: string[] = MANAGEABLE_ROUTES.map(
  (r) => r.key,
);

export function isManageableRoute(key: string): key is ManageableRouteKey {
  return MANAGEABLE_ROUTE_KEYS.includes(key);
}
