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
   * Allowlist de acesso ao app (kill switch). Enquanto o app não é liberado ao
   * público, só os CPFs desta lista conseguem logar — todos os demais são
   * barrados, mesmo já tendo o app instalado. Isso fecha o furo de a senha
   * padrão ser o próprio CPF: sem a trava, qualquer um com um CPF de associado
   * do SGA entraria.
   *
   * `APP_ASSOCIATE_ALLOWLIST` = CPFs separados por vírgula (só dígitos ou com
   * máscara). Vazia/ausente = app aberto (comportamento normal). Setar a env var
   * em produção fecha o acesso na hora, sem depender da loja.
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

  async login(dto: AssociateLoginDto) {
    const cpf = normalizeCpf(dto.cpf);

    // Kill switch: se há allowlist configurada, só ela entra. Barra antes de
    // qualquer verificação de senha.
    const allow = this.allowedCpfs();
    if (allow && !allow.has(cpf)) {
      this.logger.warn(`Login bloqueado (fora da allowlist): CPF ...${cpf.slice(-4)}`);
      throw new UnauthorizedException('O aplicativo ainda não está liberado.');
    }

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
      },
    });

    for (const a of candidates) {
      if (!(await this.passwordMatches(a.password, cpf, dto.password))) continue;

      await this.prisma.associate.update({
        where: { id: a.id },
        data: {
          lastLoginAt: new Date(),
          // Primeiro acesso: materializa a senha padrão (CPF) como hash.
          ...(a.password ? {} : { password: await bcrypt.hash(cpf, BCRYPT_ROUNDS) }),
        },
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
   * A senha padrão do app é o próprio CPF: o associado é liberado no SGA e loga
   * sem nenhuma etapa de ativação — login e senha são o mesmo CPF. O hash em
   * banco continua sendo aceito (caminho alternativo, e base pra uma futura
   * troca de senha), mas o CPF vale sempre enquanto não existir essa tela.
   */
  private async passwordMatches(
    hash: string | null,
    cpf: string,
    typed: string,
  ): Promise<boolean> {
    // Digitar o CPF com ou sem máscara no campo senha dá no mesmo.
    if (cpf.length === 11 && normalizeCpf(typed) === cpf) return true;
    return !!hash && bcrypt.compare(typed, hash);
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
