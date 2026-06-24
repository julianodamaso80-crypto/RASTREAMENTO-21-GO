import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface AssociatePayload {
  sub: string;
  type: 'associate';
  tenantId: string;
  name: string;
}

/**
 * Guard do app do associado. Valida um JWT com `type: 'associate'` e popula
 * `req.associate` + `req.tenantId`. As rotas do app são marcadas `@Public()` pra
 * pular o JwtAuthGuard global (que busca na tabela User) — este guard assume o
 * controle e isola o associado ao próprio tenant.
 */
@Injectable()
export class AssociateJwtGuard implements CanActivate {
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

    const token = header.slice(7);
    let payload: AssociatePayload;
    try {
      payload = this.jwt.verify<AssociatePayload>(token, {
        secret: this.config.get<string>('jwt.secret')!,
      });
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }

    if (payload.type !== 'associate') {
      throw new UnauthorizedException('Token não é de associado');
    }

    const associate = await this.prisma.associate.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: {
        id: true,
        name: true,
        cpf: true,
        email: true,
        phone: true,
        tenantId: true,
      },
    });

    if (!associate) {
      throw new UnauthorizedException('Associado não encontrado');
    }

    req.associate = associate;
    req.tenantId = associate.tenantId;
    return true;
  }
}
