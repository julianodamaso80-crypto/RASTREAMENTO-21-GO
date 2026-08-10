import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tenantId: string;
  /** Ausente só em token legado, emitido antes da separação dos dois mundos. */
  type?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly requireType: boolean;

  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret')!,
    });
    this.requireType = !!configService.get<boolean>('jwt.requireType');
  }

  async validate(payload: JwtPayload) {
    // Barreira de mundo. O segredo separado já deveria ter derrubado um token
    // de associado aqui, mas esta checagem é a segunda camada: se algum dia as
    // duas variáveis de ambiente forem apontadas pro mesmo valor por engano,
    // ainda assim nenhum cliente entra no painel.
    if (payload.type && payload.type !== 'user') {
      throw new UnauthorizedException('Token não pertence ao painel');
    }
    if (this.requireType && payload.type !== 'user') {
      throw new UnauthorizedException('Token sem identificação de origem');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        active: true,
        allowedRoutes: true,
      },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('Usuário não encontrado ou inativo');
    }

    return user;
  }
}
