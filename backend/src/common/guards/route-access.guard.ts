import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '.prisma/client';
import { REQUIRED_ROUTE_KEY } from '../decorators/require-route.decorator';

interface RequestUser {
  role: Role;
  allowedRoutes?: string[];
}

/**
 * Barra chamadas de API pra telas que o usuário não tem liberadas.
 *
 * Sem isso a permissão seria só cosmética: bastaria chamar o endpoint direto.
 * `allowedRoutes` vazio mantém o comportamento antigo (tudo que o role permite).
 */
@Injectable()
export class RouteAccessGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) {
      return true;
    }

    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>()
      .user;
    if (!user) {
      return false;
    }

    if (user.role === Role.SUPER_ADMIN) {
      return true;
    }

    const allowed = user.allowedRoutes ?? [];
    if (allowed.length === 0) {
      return true;
    }

    if (required.some((route) => allowed.includes(route))) {
      return true;
    }

    throw new ForbiddenException(
      'Acesso negado: esta tela não está liberada pro seu usuário',
    );
  }
}
