import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeCpf } from '../technicians/technicians.service';
import { TechLoginDto } from './dto/tech-login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class TechAuthService {
  private readonly logger = new Logger(TechAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: TechLoginDto) {
    const cpf = normalizeCpf(dto.cpf);

    // Mesmo CPF pode existir em tenants diferentes (multi-tenant). Busca todos os
    // candidatos com senha definida e valida o hash 1 a 1 — o que bater vence.
    const candidates = await this.prisma.technician.findMany({
      where: { cpf, deletedAt: null, active: true, password: { not: null } },
      select: {
        id: true,
        name: true,
        cpf: true,
        tenantId: true,
        password: true,
        mustChangePassword: true,
      },
    });

    for (const t of candidates) {
      if (t.password && (await bcrypt.compare(dto.password, t.password))) {
        await this.prisma.technician.update({
          where: { id: t.id },
          data: { lastLoginAt: new Date() },
        });

        const { password: _omit, ...technician } = t;
        return {
          accessToken: this.jwt.sign({
            sub: t.id,
            type: 'technician' as const,
            tenantId: t.tenantId,
            name: t.name,
          }),
          technician,
        };
      }
    }

    // Mensagem genérica — não revela se o CPF existe nem se está inativo.
    throw new UnauthorizedException('CPF ou senha inválidos');
  }

  async me(technicianId: string) {
    const technician = await this.prisma.technician.findFirst({
      where: { id: technicianId, deletedAt: null },
      select: {
        id: true,
        name: true,
        cpf: true,
        phone: true,
        mustChangePassword: true,
        tenant: {
          select: { id: true, name: true, logoUrl: true, primaryColor: true },
        },
      },
    });
    if (!technician) throw new UnauthorizedException('Técnico não encontrado');
    return technician;
  }

  async changePassword(technicianId: string, dto: ChangePasswordDto) {
    const technician = await this.prisma.technician.findFirst({
      where: { id: technicianId, deletedAt: null, active: true },
      select: { id: true, name: true, password: true },
    });
    if (!technician?.password) {
      throw new UnauthorizedException('Técnico não encontrado');
    }

    const ok = await bcrypt.compare(dto.currentPassword, technician.password);
    if (!ok) throw new UnauthorizedException('Senha atual incorreta');

    await this.prisma.technician.update({
      where: { id: technician.id },
      data: {
        password: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS),
        mustChangePassword: false,
      },
    });
    this.logger.log(`Técnico ${technician.name} trocou a senha`);
    return { ok: true };
  }
}
