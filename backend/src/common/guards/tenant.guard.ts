import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '.prisma/client';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return true; // Rotas públicas
    }

    // SUPER_ADMIN pode usar header x-tenant-id para agir em nome de outra tenant
    if (user.role === Role.SUPER_ADMIN) {
      const headerTenantId = request.headers['x-tenant-id'];
      if (headerTenantId) {
        request.tenantId = headerTenantId;
      } else {
        request.tenantId = user.tenantId;
      }
      return true;
    }

    if (!user.tenantId) {
      throw new ForbiddenException('Usuário sem tenant associada');
    }

    request.tenantId = user.tenantId;
    return true;
  }
}
