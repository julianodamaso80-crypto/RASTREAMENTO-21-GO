import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import { EmailService } from '../email/email.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  PasswordResetService,
  RepositorioReset,
} from './password-reset.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { Prisma } from '.prisma/client';
import { variantesTelefone } from './telefone';

const RESET_TOKEN_LIFETIME_MINUTES = 60;
const BCRYPT_ROUNDS = 10;
const EMAIL_LIMIT_PER_HOUR = 3;
const IP_LIMIT_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // In-memory rolling window rate limiter (1 replica — suficiente)
  // Chave → timestamps de tentativas dentro da janela
  private readonly forgotAttempts = new Map<string, number[]>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private traccarService: TraccarService,
    private emailService: EmailService,
    private readonly reset: PasswordResetService,
    private readonly whatsapp: WhatsappService,
  ) {}

  private checkRateLimit(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const existing = this.forgotAttempts.get(key) || [];
    const filtered = existing.filter((t) => now - t < windowMs);
    if (filtered.length >= max) {
      this.forgotAttempts.set(key, filtered);
      return false;
    }
    filtered.push(now);
    this.forgotAttempts.set(key, filtered);
    return true;
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      type: 'user' as const,
    };

    const { password: _, ...userWithoutPassword } = user;

    return {
      accessToken: this.jwtService.sign(payload),
      user: userWithoutPassword,
    };
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('Email já cadastrado');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
        role: dto.role,
        tenantId: dto.tenantId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        createdAt: true,
      },
    });

    // Tenta criar usuário no Traccar (não bloqueia se falhar)
    try {
      const traccarUser = await this.traccarService.createUser(
        dto.email,
        dto.password,
        dto.name,
      );
      await this.prisma.user.update({
        where: { id: user.id },
        data: { traccarUserId: traccarUser.id },
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao criar usuário no Traccar: ${error instanceof Error ? error.message : error}`,
      );
    }

    return user;
  }

  async forgotPassword(dto: ForgotPasswordDto, ip: string): Promise<void> {
    const email = dto.email.trim().toLowerCase();

    // Rate limit por IP (10/hora) — sempre aplicado antes de qualquer trabalho
    if (!this.checkRateLimit(`ip:${ip}`, IP_LIMIT_PER_HOUR, HOUR_MS)) {
      throw new HttpException(
        'Muitas tentativas deste IP. Tente novamente em 1 hora.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Rate limit por email (3/hora)
    if (!this.checkRateLimit(`email:${email}`, EMAIL_LIMIT_PER_HOUR, HOUR_MS)) {
      // Silent: não revela que email existe. Apenas retorna como se tivesse enviado.
      this.logger.warn(`Rate limit por email atingido: ${email} (ip=${ip})`);
      return;
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    // Response é sempre 202 independente de existir ou não (não revela enumeração)
    if (!user || !user.active) {
      this.logger.log(
        `Forgot-password pra email inexistente ou inativo: ${email}`,
      );
      return;
    }

    // Gera token aleatório 32 bytes → 64 hex chars. Enviado no link.
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(rawToken, BCRYPT_ROUNDS);
    const expiresAt = new Date(
      Date.now() + RESET_TOKEN_LIFETIME_MINUTES * 60 * 1000,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: tokenHash,
        resetTokenExpiresAt: expiresAt,
      },
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    await this.emailService.sendPasswordReset({
      to: user.email,
      name: user.name,
      resetUrl,
      expiresInMinutes: RESET_TOKEN_LIFETIME_MINUTES,
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // Busca usuários com token ainda dentro do lifetime (idealmente 0 ou 1 registro).
    // Não dá pra fazer lookup direto pelo hash, só tem como comparar 1-a-1.
    const candidates = await this.prisma.user.findMany({
      where: {
        resetTokenHash: { not: null },
        resetTokenExpiresAt: { gte: new Date() },
      },
      select: { id: true, resetTokenHash: true },
    });

    let matchedUserId: string | null = null;
    for (const c of candidates) {
      if (!c.resetTokenHash) continue;
      const ok = await bcrypt.compare(dto.token, c.resetTokenHash);
      if (ok) {
        matchedUserId = c.id;
        break;
      }
    }

    if (!matchedUserId) {
      throw new BadRequestException('Token inválido ou expirado');
    }

    const newHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    // Update atômico: grava nova senha E invalida o token (single-use)
    await this.prisma.user.update({
      where: { id: matchedUserId },
      data: {
        password: newHash,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });

    this.logger.log(`Senha redefinida com sucesso: userId=${matchedUserId}`);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        allowedRoutes: true,
        phone: true,
        phoneVerifiedAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            primaryColor: true,
          },
        },
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    const { phoneVerifiedAt, ...resto } = user;
    const verificado = Boolean(phoneVerifiedAt);
    return {
      ...resto,
      phoneVerified: verificado,
      // O popup bloqueia a navegação — exigir com o canal desligado trancaria
      // o usuário fora do painel, sem como receber o código pra sair de lá.
      phoneVerificationRequired: this.whatsapp.habilitado && !verificado,
    };
  }

  // ---------------------------------------------------------------------------
  // Esqueci minha senha — código de 6 dígitos no WhatsApp
  //
  // Mesmo motor do app do associado e do PWA do técnico. O caminho antigo por
  // e-mail (`forgotPassword`/`resetPassword`) continua funcionando, mas o painel
  // não o oferece mais na tela.
  // ---------------------------------------------------------------------------

  /** Port do motor de recuperação sobre a tabela de usuários do painel. */
  private repoReset(): RepositorioReset {
    return {
      buscar: async (telefone) => {
        // Só telefone VERIFICADO recebe código — é o número que a pessoa
        // provou ter no popup do login.
        const variantes = variantesTelefone(telefone);
        if (!variantes.length) return null;
        const achados = await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM users
          WHERE deleted_at IS NULL
            AND active = true
            AND phone_verified_at IS NOT NULL
            AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') IN (${Prisma.join(variantes)})
          LIMIT 2`;
        // Mesmo número em duas contas: ninguém recebe, e a resposta neutra cobre.
        if (achados.length !== 1) return null;
        const u = await this.prisma.user.findFirst({
          where: { id: achados[0].id },
          select: {
            id: true,
            phone: true,
            resetCodeHash: true,
            resetCodeExpiresAt: true,
            resetCodeAttempts: true,
            resetCodeSentAt: true,
          },
        });
        return u ?? null;
      },
      gravarCodigo: async (id, hash, expiraEm) => {
        await this.prisma.user.update({
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
        await this.prisma.user.update({
          where: { id },
          data: { resetCodeAttempts: { increment: 1 } },
        });
      },
      limparCodigo: async (id) => {
        await this.prisma.user.update({
          where: { id },
          data: {
            resetCodeHash: null,
            resetCodeExpiresAt: null,
            resetCodeAttempts: 0,
          },
        });
      },
      gravarSenha: async (id, hash) => {
        await this.prisma.user.update({
          where: { id },
          // Invalida também o token de e-mail: uma recuperação encerra a outra.
          data: {
            password: hash,
            resetTokenHash: null,
            resetTokenExpiresAt: null,
          },
        });
      },
    };
  }

  async forgotPasswordWhatsapp(telefone: string) {
    return this.reset.enviarCodigo(this.repoReset(), telefone, 'WhatsApp');
  }

  async resetPasswordWhatsapp(
    telefone: string,
    codigo: string,
    novaSenha: string,
  ) {
    return this.reset.redefinirSenha(
      this.repoReset(),
      telefone,
      codigo,
      novaSenha,
    );
  }
}
