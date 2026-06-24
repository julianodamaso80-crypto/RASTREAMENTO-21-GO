import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AssociateLoginDto } from './dto/associate-login.dto';

const BCRYPT_ROUNDS = 10;

/** Remove máscara do CPF, deixando só dígitos. */
function normalizeCpf(cpf: string): string {
  return (cpf || '').replace(/\D/g, '');
}

@Injectable()
export class AssociateAuthService {
  private readonly logger = new Logger(AssociateAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: AssociateLoginDto) {
    const cpf = normalizeCpf(dto.cpf);

    // Mesmo CPF pode existir em mais de um tenant (multi-tenant). Buscamos todos os
    // candidatos com senha definida e validamos o hash 1-a-1 — o que bater vence.
    const candidates = await this.prisma.associate.findMany({
      where: { cpf, deletedAt: null, password: { not: null } },
      select: {
        id: true,
        name: true,
        cpf: true,
        email: true,
        phone: true,
        tenantId: true,
        password: true,
      },
    });

    for (const a of candidates) {
      if (a.password && (await bcrypt.compare(dto.password, a.password))) {
        await this.prisma.associate.update({
          where: { id: a.id },
          data: { lastLoginAt: new Date() },
        });

        const payload = {
          sub: a.id,
          type: 'associate' as const,
          tenantId: a.tenantId,
          name: a.name,
        };

        const { password: _omit, ...associate } = a;
        return { accessToken: this.jwt.sign(payload), associate };
      }
    }

    // Mensagem genérica — não revela se o CPF existe.
    throw new UnauthorizedException('CPF ou senha inválidos');
  }

  async me(associateId: string) {
    const associate = await this.prisma.associate.findFirst({
      where: { id: associateId, deletedAt: null },
      select: {
        id: true,
        name: true,
        cpf: true,
        email: true,
        phone: true,
        tenantId: true,
        tenant: {
          select: { id: true, name: true, logoUrl: true, primaryColor: true },
        },
        _count: { select: { vehicles: { where: { deletedAt: null } } } },
      },
    });

    if (!associate) {
      throw new UnauthorizedException('Associado não encontrado');
    }
    return associate;
  }

  /**
   * Define/redefine a senha de um associado (uso operacional/admin).
   * Normaliza o CPF e exige que o associado exista e não esteja deletado.
   */
  async setPasswordByCpf(rawCpf: string, plainPassword: string) {
    const cpf = normalizeCpf(rawCpf);
    const associate = await this.prisma.associate.findFirst({
      where: { cpf, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!associate) {
      throw new UnauthorizedException(`Associado com CPF ${cpf} não encontrado`);
    }
    const hash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
    await this.prisma.associate.update({
      where: { id: associate.id },
      data: { password: hash },
    });
    this.logger.log(`Senha definida pro associado ${associate.name} (${cpf})`);
    return { id: associate.id, name: associate.name };
  }
}
