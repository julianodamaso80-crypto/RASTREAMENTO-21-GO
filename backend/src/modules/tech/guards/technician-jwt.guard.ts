import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface TechnicianPayload {
  sub: string;
  type: 'technician';
  tenantId: string;
  name: string;
}

/**
 * Guard do PWA do técnico. Valida JWT com `type: 'technician'` e popula
 * `req.technician` + `req.tenantId`. As rotas são `@Public()` pra pular o
 * JwtAuthGuard global (que busca na tabela User) — este guard assume o controle.
 *
 * Recarrega o técnico do banco a cada request: desativar no painel derruba o
 * acesso na hora, sem esperar o token expirar.
 */
@Injectable()
export class TechnicianJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token ausente');
    }

    let payload: TechnicianPayload;
    try {
      payload = this.jwt.verify<TechnicianPayload>(header.slice(7), {
        secret: this.config.get<string>('jwt.secret')!,
      });
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }

    if (payload.type !== 'technician') {
      throw new UnauthorizedException('Token não é de técnico');
    }

    const technician = await this.prisma.technician.findFirst({
      where: { id: payload.sub, deletedAt: null, active: true },
      select: { id: true, name: true, tenantId: true, mustChangePassword: true },
    });
    if (!technician) {
      throw new UnauthorizedException('Técnico inativo ou removido');
    }

    req.technician = technician;
    req.tenantId = technician.tenantId;
    return true;
  }
}
