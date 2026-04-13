/**
 * Configuração centralizada do Dashboard.
 * Ajuste aqui os thresholds e não precise mexer em múltiplos componentes.
 */

export const DASHBOARD_CONFIG = {
  /** Bateria abaixo deste valor (0–100) conta como warning no card de saúde. */
  BATTERY_LOW_PCT: 20,

  /** Veículo sem ping há mais que isso é considerado offline pelo dashboard. */
  OFFLINE_THRESHOLD_MS: 60 * 60 * 1000, // 1h

  /** Intervalo de refresh dos dados agregados (polling de fallback ao WebSocket). */
  REFRESH_INTERVAL_MS: 60 * 1000, // 60s

  /** TTL do cache local de queries. */
  CACHE_TTL_MS: 60 * 1000, // 60s

  /** Quantidade de itens em rankings (top N veículos, top alertas, etc.). */
  TOP_N: 10,

  /** Número de eventos exibidos na tabela "Últimos eventos". */
  LATEST_EVENTS_COUNT: 10,

  /** Janela de análise para o gráfico de alertas por hora. */
  ALERTS_WINDOW_HOURS: 24,

  /** % mínima de frota online para o card ficar verde (ok). */
  ONLINE_OK_PCT: 80,

  /** % mínima de frota online para o card ficar amarelo (warning). Abaixo disso vira crítico. */
  ONLINE_WARNING_PCT: 50,

  /** Limiar de alertas em 24h para warning amarelo. */
  ALERTS_24H_WARNING: 10,
} as const;

export type DashboardConfig = typeof DASHBOARD_CONFIG;
