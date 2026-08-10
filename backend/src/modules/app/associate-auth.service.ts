import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AssociateLoginDto } from './dto/associate-login.dto';

const BCRYPT_ROUNDS = 10;

/** Remove máscara do CPF, deixando só dígitos. */
function normalizeCpf(cpf: string): string {
  return (cpf || '').replace(/\D/g, '');
}

/** Formatos em que o CPF pode ter sido gravado: só dígitos ou com máscara. */
function cpfVariants(digits: string): string[] {
  if (digits.length !== 11) return [digits];
  const masked = digits.replace(
    /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
    '$1.$2.$3-$4',
  );
  return [digits, masked];
}

@Injectable()
export class AssociateAuthService {
  private readonly logger = new Logger(AssociateAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Allowlist de testadores — bypass da regra "só quem tem rastreador instalado".
   * Serve pra quem precisa entrar sem device real (você, equipe de teste). Quem
   * está aqui entra mesmo sem rastreador; quem não está segue a regra normal
   * (precisa de rastreador instalado).
   *
   * `APP_ASSOCIATE_ALLOWLIST` = CPFs separados por vírgula (dígitos ou com
   * máscara). Vazia/ausente = ninguém tem bypass, e aí só cliente com rastreador
   * instalado loga.
   */
  private allowedCpfs(): Set<string> | null {
    const raw = process.env.APP_ASSOCIATE_ALLOWLIST?.trim();
    if (!raw) return null;
    const set = new Set(
      raw
        .split(',')
        .map((c) => normalizeCpf(c))
        .filter((c) => c.length > 0),
    );
    return set.size ? set : null;
  }

  /**
   * Regra de acesso ao app (a que o dono pediu): só loga quem é cliente real,
   * ou seja, quem tem **rastreador instalado**. Um associado sem device vinculado
   * não tem o que ver no app e não deve entrar — mesmo que o CPF exista no banco
   * (senão, com a senha padrão sendo o CPF, qualquer um com o CPF de um cliente
   * entraria assim que a base do SGA fosse sincronizada).
   *
   * "Instalado" = qualquer device já passado da instalação; PENDING_INSTALL
   * (ainda não instalado) e DEACTIVATED (desligado) não dão acesso.
   */
  private static readonly STATUS_COM_ACESSO = [
    'INSTALLED',
    'CONFIGURING',
    'ONLINE',
    'OFFLINE',
    'MAINTENANCE',
  ] as const;

  private async hasInstalledTracker(associateId: string): Promise<boolean> {
    const n = await this.prisma.device.count({
      where: {
        status: { in: [...AssociateAuthService.STATUS_COM_ACESSO] as any },
        vehicle: { associateId, deletedAt: null },
      },
    });
    return n > 0;
  }

  /**
   * Login do associado.
   *
   * Regra de senha (definida pelo dono em 2026-08-10):
   * - **Primeiro acesso**: login = CPF e senha = CPF. Nenhuma etapa de ativação.
   * - A partir daí o app **obriga** a trocar por uma senha escolhida pelo
   *   cliente, e o CPF **deixa de funcionar como senha**.
   *
   * O motivo é sério: CPF é dado semi-público no Brasil. Enquanto ele valia
   * como senha permanente, qualquer um que soubesse o CPF de um cliente
   * acompanhava a localização do carro dele em tempo real — vetor de
   * perseguição e de roubo dirigido. Ver P1.8 do plano.
   */
  async login(dto: AssociateLoginDto) {
    const cpf = normalizeCpf(dto.cpf);

    // Mesmo CPF pode existir em mais de um tenant (multi-tenant). Buscamos todos
    // os candidatos e validamos 1-a-1 — o que bater vence. A busca tolera CPF
    // gravado com máscara (o SGA às vezes devolve "085.775.907-80").
    const candidates = await this.prisma.associate.findMany({
      where: { cpf: { in: cpfVariants(cpf) }, deletedAt: null },
      select: {
        id: true,
        name: true,
        cpf: true,
        email: true,
        phone: true,
        tenantId: true,
        password: true,
        mustChangePassword: true,
      },
    });

    const allow = this.allowedCpfs();

    for (const a of candidates) {
      if (
        !(await this.passwordMatches(
          a.password,
          cpf,
          dto.password,
          a.mustChangePassword,
        ))
      ) {
        continue;
      }

      // Direito de acesso: allowlist (testadores) OU rastreador instalado.
      const naAllowlist = allow?.has(cpf) ?? false;
      if (!naAllowlist && !(await this.hasInstalledTracker(a.id))) {
        this.logger.warn(
          `Login bloqueado (sem rastreador instalado): CPF ...${cpf.slice(-4)}`,
        );
        throw new UnauthorizedException(
          'Nenhum rastreador instalado vinculado ao seu CPF. Fale com a sua associação.',
        );
      }

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

    // Mensagem genérica — não revela se o CPF existe.
    throw new UnauthorizedException('CPF ou senha inválidos');
  }

  /**
   * O CPF só é aceito como senha enquanto o associado **ainda não trocou**
   * (`mustChangePassword`). Depois da troca, vale exclusivamente o hash — é o
   * que impede que quem descobriu o CPF do cliente entre na conta dele.
   */
  private async passwordMatches(
    hash: string | null,
    cpf: string,
    typed: string,
    mustChangePassword: boolean,
  ): Promise<boolean> {
    if (mustChangePassword) {
      // Primeiro acesso: CPF com ou sem máscara no campo senha dá no mesmo.
      if (cpf.length === 11 && normalizeCpf(typed) === cpf) return true;
    }
    return !!hash && (await bcrypt.compare(typed, hash));
  }

  /**
   * Troca de senha feita pelo próprio associado no app. É o que encerra o
   * período em que o CPF vale como senha.
   */
  async changePassword(
    associateId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const associate = await this.prisma.associate.findFirst({
      where: { id: associateId, deletedAt: null },
      select: { id: true, cpf: true, password: true, mustChangePassword: true },
    });
    if (!associate) throw new UnauthorizedException('Associado não encontrado');

    const cpf = normalizeCpf(associate.cpf);
    const confere = await this.passwordMatches(
      associate.password,
      cpf,
      currentPassword,
      associate.mustChangePassword,
    );
    if (!confere) {
      throw new UnauthorizedException('Senha atual incorreta');
    }

    // A senha nova não pode ser o próprio CPF — seria voltar ao problema.
    if (normalizeCpf(newPassword) === cpf) {
      throw new BadRequestException(
        'A nova senha não pode ser o seu CPF. Escolha outra.',
      );
    }
    if (newPassword.trim().length < 6) {
      throw new BadRequestException('A nova senha precisa ter ao menos 6 caracteres.');
    }

    await this.prisma.associate.update({
      where: { id: associate.id },
      data: {
        password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        mustChangePassword: false,
      },
    });

    this.logger.log(`Associado ...${cpf.slice(-4)} definiu senha própria.`);
    return { ok: true };
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
        // O app usa isto pra abrir a tela de troca de senha antes de qualquer
        // outra coisa no primeiro acesso.
        mustChangePassword: true,
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
      // Senha definida pelo suporte também encerra o período em que o CPF vale.
      data: { password: hash, mustChangePassword: false },
    });
    this.logger.log(`Senha definida pro associado ${associate.name} (${cpf})`);
    return { id: associate.id, name: associate.name };
  }
}
