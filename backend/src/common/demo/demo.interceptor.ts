import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { MENSAGEM_DEMO, rodarComoDemo } from './demo-context';

export const MENSAGEM_CONTA_DEMO =
  'A conta de demonstração é compartilhada: senha, e-mail e acesso dela não mudam.';
import { DemoTenantsService } from './demo-tenants.service';

interface UsuarioDaRequisicao {
  id?: string;
  isDemo?: boolean;
  tenantId?: string;
}

/**
 * Abre o contexto de demonstração para toda requisição de usuário de tenant
 * `isDemo`. Tudo o que o handler fizer — inclusive o que ele disparar em
 * segundo plano — enxerga `emDemo() === true`.
 *
 * Também prende a demo dentro da própria empresa: qualquer `tenantId` vindo
 * no corpo vira o da demo, e as rotas que só existem para mexer em OUTRAS
 * empresas respondem com aviso.
 */
@Injectable()
export class DemoInterceptor implements NestInterceptor {
  constructor(private readonly demoTenants: DemoTenantsService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{
      user?: UsuarioDaRequisicao;
      body?: Record<string, unknown>;
      method: string;
      path?: string;
      url: string;
      tenantId?: string;
    }>();
    // Painel: o usuário já vem marcado pela estratégia JWT. App do associado e
    // PWA do técnico: decide pelo tenant que o guard deles resolveu.
    const user = req.user;
    const tenantId = user?.isDemo
      ? user.tenantId
      : req.tenantId && (await this.demoTenants.ehDemo(req.tenantId))
        ? req.tenantId
        : undefined;
    if (!tenantId) return next.handle();

    req.tenantId = tenantId;
    if (req.body && typeof req.body === 'object' && 'tenantId' in req.body) {
      req.body.tenantId = tenantId;
    }

    // Express casa rota sem diferenciar maiúscula (/TENANTS == /tenants).
    const caminho = (req.path ?? req.url.split('?')[0])
      .replace(/\/+$/, '')
      .toLowerCase();
    if (rotaProibidaNaDemo(req.method, caminho)) {
      throw new ForbiddenException(MENSAGEM_DEMO);
    }
    if (user?.id && alteraAPropriaContaDemo(req.method, caminho, user.id)) {
      throw new ForbiddenException(MENSAGEM_CONTA_DEMO);
    }

    return new Observable((assinante) =>
      rodarComoDemo(tenantId, () => next.handle().subscribe(assinante)),
    );
  }
}

/** Ações que só existem para mexer em outras empresas. */
export function rotaProibidaNaDemo(metodo: string, caminho: string): boolean {
  const m = metodo.toUpperCase();
  if (/\/tenants$/.test(caminho) && m === 'POST') return true;
  if (/\/tenants\/[^/]+$/.test(caminho) && m === 'DELETE') return true;
  if (/\/admin\/(deleted|restore)\/tenant(\/|$)/.test(caminho)) return true;
  return false;
}

/**
 * A conta de demonstração é usada por muita gente: ninguém troca a senha, o
 * e-mail, o papel nem apaga ESSA conta (senão tranca a demo para os outros).
 * Usuários novos que o visitante criar dentro da demo continuam editáveis.
 */
export function alteraAPropriaContaDemo(
  metodo: string,
  caminho: string,
  meuId: string,
): boolean {
  const m = metodo.toUpperCase();
  if (/\/auth\/change-password$/.test(caminho)) return true;
  const alvo = /\/users\/([^/]+)(\/reset-password)?$/.exec(caminho);
  if (!alvo || alvo[1] !== meuId) return false;
  return m === 'PATCH' || m === 'DELETE' || (m === 'POST' && !!alvo[2]);
}
