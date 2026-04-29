import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttler que rastreia requests por tenantId quando autenticado, ou por IP
 * quando público. Padrão do `@nestjs/throttler` é só por IP — falha em SaaS
 * porque operadores de empresas grandes ficam atrás de um único NAT corporativo
 * e drop em uns no outros.
 *
 * Default IP: 100/min globalmente.
 * Com tenant: 100/min por tenant (cada empresa tem sua quota).
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    // request.tenantId é setado pelo TenantGuard após JWT.
    const tenantId = (req as { tenantId?: string }).tenantId;
    if (tenantId) return `tenant:${tenantId}`;
    // Fallback IP — pra rotas públicas (login, health, etc).
    const ip =
      (req as { ip?: string }).ip ??
      (req as { headers?: Record<string, string | string[]> }).headers?.[
        'x-forwarded-for'
      ] ??
      'unknown';
    return `ip:${Array.isArray(ip) ? ip[0] : ip}`;
  }
}
