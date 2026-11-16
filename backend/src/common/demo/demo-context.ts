import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto da empresa de DEMONSTRAÇÃO.
 *
 * Toda requisição de um usuário de tenant `isDemo` roda dentro deste contexto
 * (o DemoInterceptor abre). Os pontos que falam com o mundo real — Traccar,
 * SGA, Power, WhatsApp, e-mail, push, CRM de boletos — perguntam `emDemo()`
 * e, se for, SIMULAM a resposta em vez de chamar o serviço de fora.
 *
 * Trabalho disparado em segundo plano por essa requisição (`void algo()`)
 * herda o contexto: o AsyncLocalStorage acompanha as continuações async.
 *
 * Cron não tem requisição, logo não tem contexto: cron que itera tenants tem
 * que excluir os de demonstração explicitamente (DemoTenantsService).
 */
interface ContextoDemo {
  demo: true;
  tenantId: string;
}

const armazem = new AsyncLocalStorage<ContextoDemo>();

export function emDemo(): boolean {
  return armazem.getStore()?.demo === true;
}

export function tenantDaDemo(): string | null {
  return armazem.getStore()?.tenantId ?? null;
}

export function rodarComoDemo<T>(tenantId: string, fn: () => T): T {
  return armazem.run({ demo: true, tenantId }, fn);
}

/** Erro amigável para o que não existe numa demonstração (ex.: criar empresa). */
export const MENSAGEM_DEMO =
  'Indisponível na demonstração: esta ação mexe em outras empresas.';

let proximoIdFalso = 0;
/**
 * Id NEGATIVO para "device"/"geofence" criados durante a demo. Nunca colide
 * com um id real do Traccar (que é sempre positivo), então nenhuma leitura
 * posterior por esse id alcança dado de verdade.
 */
export function idFalsoTraccar(): number {
  proximoIdFalso -= 1;
  return -1_000_000 + proximoIdFalso - Math.floor(Math.random() * 1_000_000);
}
