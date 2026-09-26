import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';

/**
 * Limite para quem está logado, por usuário. Cada aba do painel aberta no mapa
 * já faz ~15 requisições/min (posições e devices a cada 8 s); com busca e
 * estoque juntos, um operador ativo passa de 100.
 */
export const LIMITE_POR_USUARIO = 300;

type Requisicao = {
  user?: { id?: string };
  tenantId?: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
};

/**
 * De quem é a cota. Antes era da EMPRESA inteira (tenant): em 16/09/2026 o
 * escritório somou 305 req/min e o Estoque abriu "Erro ao carregar estoque"
 * para todos (32 respostas 429 no access log). Cada usuário tem a sua agora.
 * Rota pública (login etc.) continua por IP, que é o que segura força bruta.
 */
export function rastreadorDaRequisicao(req: Requisicao): string {
  if (req.user?.id) return `user:${req.user.id}`;
  if (req.tenantId) return `tenant:${req.tenantId}`;
  const ip = req.ip ?? req.headers?.['x-forwarded-for'] ?? 'unknown';
  return `ip:${Array.isArray(ip) ? ip[0] : ip}`;
}

export function limiteDaRequisicao(req: Requisicao, limitePadrao: number): number {
  return req.user?.id ? LIMITE_POR_USUARIO : limitePadrao;
}

@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return rastreadorDaRequisicao(req as Requisicao);
  }

  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { req } = this.getRequestResponse(requestProps.context);
    return super.handleRequest({
      ...requestProps,
      limit: limiteDaRequisicao(req as Requisicao, requestProps.limit),
    });
  }
}
