import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import {
  PasswordResetService,
  RepositorioReset,
} from '../auth/password-reset.service';
import { WhatsappService } from '../notifications/whatsapp.service';
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
    private readonly reset: PasswordResetService,
    private readonly whatsapp: WhatsappService,
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
        phoneVerifiedAt: true,
        mustChangePassword: true,
        tenant: {
          select: { id: true, name: true, logoUrl: true, primaryColor: true },
        },
      },
    });
    if (!technician) throw new UnauthorizedException('Técnico não encontrado');
    const { phoneVerifiedAt, ...resto } = technician;
    const verificado = Boolean(phoneVerifiedAt);
    return {
      ...resto,
      phoneVerified: verificado,
      // Mesma regra do painel: sem canal de envio o popup trancaria o técnico
      // fora do PWA, em campo, sem como receber o código.
      phoneVerificationRequired: this.whatsapp.habilitado && !verificado,
    };
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

  // ---------------------------------------------------------------------------
  // Esqueci minha senha — código de 6 dígitos no WhatsApp
  // ---------------------------------------------------------------------------

  /**
   * Port do motor de recuperação sobre a tabela de técnicos.
   *
   * Rota pública, antes do login: não há `tenantId`. O CPF é único por tenant,
   * então a busca global pode encontrar o mesmo CPF em tenants diferentes —
   * nesse caso não enviamos nada, e a resposta genérica cobre o caso sem
   * revelar que houve ambiguidade.
   */
  private repoReset(): RepositorioReset {
    return {
      buscar: async (cpf) => {
        const candidatos = await this.prisma.technician.findMany({
          where: { cpf, deletedAt: null, active: true },
          select: {
            id: true,
            phone: true,
            resetCodeHash: true,
            resetCodeExpiresAt: true,
            resetCodeAttempts: true,
            resetCodeSentAt: true,
          },
        });
        return candidatos.length === 1 ? candidatos[0] : null;
      },
      gravarCodigo: async (id, hash, expiraEm) => {
        await this.prisma.technician.update({
          where: { id },
          data: {
            resetCodeHash: hash,
            resetCodeExpiresAt: expiraEm,
            resetCodeAttempts: 0,
            resetCodeSentAt: new Date(),
          },
        });
      },
      contarTentativa: async (id) => {
        await this.prisma.technician.update({
          where: { id },
          data: { resetCodeAttempts: { increment: 1 } },
        });
      },
      limparCodigo: async (id) => {
        await this.prisma.technician.update({
          where: { id },
          data: {
            resetCodeHash: null,
            resetCodeExpiresAt: null,
            resetCodeAttempts: 0,
          },
        });
      },
      gravarSenha: async (id, hash) => {
        await this.prisma.technician.update({
          where: { id },
          // A senha escolhida pelo técnico já é a definitiva.
          data: { password: hash, mustChangePassword: false },
        });
      },
    };
  }

  async forgotPassword(rawCpf: string) {
    return this.reset.enviarCodigo(
      this.repoReset(),
      normalizeCpf(rawCpf),
      'CPF',
    );
  }

  async resetPasswordWithCode(
    rawCpf: string,
    codigo: string,
    novaSenha: string,
  ) {
    const cpf = normalizeCpf(rawCpf);
    return this.reset.redefinirSenha(
      this.repoReset(),
      cpf,
      codigo,
      novaSenha,
      (senha) => {
        if (senha.replace(/\D/g, '') === cpf) {
          throw new BadRequestException(
            'A nova senha não pode ser o seu CPF. Escolha outra.',
          );
        }
      },
    );
  }
}
