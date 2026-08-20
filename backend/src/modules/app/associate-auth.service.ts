import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { AssociateLoginDto } from './dto/associate-login.dto';
import {
  docVariants,
  normalizeDoc,
  senhaEhODocumento,
} from './documento';

const BCRYPT_ROUNDS = 10;


/**
 * Senha temporária pra ser DITADA no telefone: blocos curtos, sem os caracteres
 * que se confundem na fala e na leitura (0/O, 1/I/L, 5/S). Mesmo padrão já
 * usado nas credenciais de usuário do painel.
 */
function gerarSenhaDitavel(): string {
  const alfabeto = 'ABCDEFGHJKMNPQRTUVWXYZ23479';
  const bloco = () =>
    Array.from(
      { length: 4 },
      () => alfabeto[randomInt(0, alfabeto.length)],
    ).join('');
  return `${bloco()}-${bloco()}`;
}


@Injectable()
export class AssociateAuthService {
  private readonly logger = new Logger(AssociateAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly whatsapp: WhatsappService,
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
        .map((c) => normalizeDoc(c))
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
    const cpf = normalizeDoc(dto.cpf);

    // Mesmo CPF pode existir em mais de um tenant (multi-tenant). Buscamos todos
    // os candidatos e validamos 1-a-1 — o que bater vence. A busca tolera CPF
    // gravado com máscara (o SGA às vezes devolve "085.775.907-80").
    const candidates = await this.prisma.associate.findMany({
      where: { cpf: { in: docVariants(cpf) }, deletedAt: null },
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
      // Primeiro acesso: documento com ou sem máscara no campo senha dá no
      // mesmo. Vale CPF (11) e CNPJ (14) — a base tem associado PJ.
      if (senhaEhODocumento(cpf, typed)) return true;
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

    const cpf = normalizeDoc(associate.cpf);
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
    if (normalizeDoc(newPassword) === cpf) {
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

  // ---------------------------------------------------------------------------
  // Recuperação de senha — "esqueci minha senha" no app
  // ---------------------------------------------------------------------------

  /** Validade do código. Curta de propósito: código vivo é código atacável. */
  private static readonly CODIGO_VALIDADE_MIN = 15;
  /** Tentativas erradas antes de o código morrer. */
  private static readonly CODIGO_MAX_TENTATIVAS = 5;
  /** Espaçamento mínimo entre envios pro mesmo CPF (anti-flood). */
  private static readonly CODIGO_INTERVALO_MIN = 2;

  /**
   * Envia um código de 6 dígitos pro WhatsApp cadastrado do associado.
   *
   * A resposta é SEMPRE a mesma, exista ou não o CPF: senão a rota vira um
   * verificador de "esse CPF é cliente de vocês?" pra qualquer um na internet.
   * O telefone volta mascarado só quando o envio aconteceu de fato.
   */
  async forgotPassword(rawCpf: string): Promise<{
    message: string;
    sentTo: string | null;
    canUseWhatsapp: boolean;
  }> {
    const cpf = normalizeDoc(rawCpf);
    const generico = {
      message:
        'Se esse CPF estiver cadastrado, enviamos um código no WhatsApp. ' +
        'Não chegou em alguns minutos? Fale com a sua associação.',
      sentTo: null as string | null,
      canUseWhatsapp: this.whatsapp.habilitado,
    };

    // CPF (11) ou CNPJ (14): a base tem associado pessoa jurídica.
    if (cpf.length !== 11 && cpf.length !== 14) return generico;

    const associate = await this.prisma.associate.findFirst({
      where: { cpf: { in: docVariants(cpf) }, deletedAt: null },
      select: {
        id: true,
        phone: true,
        resetCodeSentAt: true,
      },
    });
    if (!associate?.phone) {
      // Sem cadastro ou sem telefone: nada a enviar, resposta idêntica.
      if (associate) {
        this.logger.warn(
          `Recuperação pedida sem telefone cadastrado: CPF ...${cpf.slice(-4)}`,
        );
      }
      return generico;
    }

    // Anti-flood: um envio a cada 2 minutos por CPF.
    if (associate.resetCodeSentAt) {
      const desdeUltimo = Date.now() - associate.resetCodeSentAt.getTime();
      if (
        desdeUltimo <
        AssociateAuthService.CODIGO_INTERVALO_MIN * 60 * 1000
      ) {
        return {
          ...generico,
          message:
            'Já enviamos um código há pouco. Confira o WhatsApp e aguarde ' +
            'dois minutos antes de pedir outro.',
        };
      }
    }

    // randomInt do crypto: previsível é o que não pode ser.
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiraEm = new Date(
      Date.now() + AssociateAuthService.CODIGO_VALIDADE_MIN * 60 * 1000,
    );

    await this.prisma.associate.update({
      where: { id: associate.id },
      data: {
        resetCodeHash: await bcrypt.hash(codigo, BCRYPT_ROUNDS),
        resetCodeExpiresAt: expiraEm,
        resetCodeAttempts: 0,
        resetCodeSentAt: new Date(),
      },
    });

    const envio = await this.whatsapp.enviarCodigo(
      associate.phone,
      codigo,
      AssociateAuthService.CODIGO_VALIDADE_MIN,
    );

    if (!envio.enviado) {
      this.logger.warn(
        `Não consegui enviar o código pro CPF ...${cpf.slice(-4)}: ${envio.motivo}`,
      );
      return {
        message:
          'No momento não consigo enviar o código pelo WhatsApp. ' +
          'Fale com a sua associação para redefinir a sua senha.',
        sentTo: null,
        canUseWhatsapp: false,
      };
    }

    return {
      ...generico,
      sentTo: WhatsappService.mascarar(associate.phone),
    };
  }

  /**
   * Confere o código e grava a senha nova.
   *
   * Erros aqui são específicos de propósito (código errado x expirado): quem
   * chega nesta etapa já provou ter o WhatsApp do titular, e mensagem vaga só
   * atrapalharia o cliente legítimo.
   */
  async resetPasswordWithCode(
    rawCpf: string,
    codigo: string,
    novaSenha: string,
  ): Promise<{ ok: true }> {
    const cpf = normalizeDoc(rawCpf);
    const digitos = (codigo || '').replace(/\D/g, '');

    const associate = await this.prisma.associate.findFirst({
      where: { cpf: { in: docVariants(cpf) }, deletedAt: null },
      select: {
        id: true,
        resetCodeHash: true,
        resetCodeExpiresAt: true,
        resetCodeAttempts: true,
      },
    });

    const invalido = new UnauthorizedException(
      'Código inválido ou expirado. Peça um novo código.',
    );
    if (!associate?.resetCodeHash || !associate.resetCodeExpiresAt) {
      throw invalido;
    }
    if (associate.resetCodeExpiresAt.getTime() < Date.now()) {
      await this.limparCodigo(associate.id);
      throw invalido;
    }
    if (
      associate.resetCodeAttempts >= AssociateAuthService.CODIGO_MAX_TENTATIVAS
    ) {
      await this.limparCodigo(associate.id);
      throw new UnauthorizedException(
        'Muitas tentativas erradas. Peça um novo código.',
      );
    }

    if (!(await bcrypt.compare(digitos, associate.resetCodeHash))) {
      // Conta a tentativa ANTES de responder — senão força bruta é de graça.
      await this.prisma.associate.update({
        where: { id: associate.id },
        data: { resetCodeAttempts: { increment: 1 } },
      });
      throw invalido;
    }

    if (normalizeDoc(novaSenha) === cpf) {
      throw new BadRequestException(
        'A nova senha não pode ser o seu CPF. Escolha outra.',
      );
    }
    if (novaSenha.trim().length < 6) {
      throw new BadRequestException(
        'A nova senha precisa ter ao menos 6 caracteres.',
      );
    }

    await this.prisma.associate.update({
      where: { id: associate.id },
      data: {
        password: await bcrypt.hash(novaSenha, BCRYPT_ROUNDS),
        mustChangePassword: false,
        resetCodeHash: null,
        resetCodeExpiresAt: null,
        resetCodeAttempts: 0,
      },
    });

    this.logger.log(
      `Senha redefinida por código: CPF ...${cpf.slice(-4)}`,
    );
    return { ok: true };
  }

  private async limparCodigo(associateId: string) {
    await this.prisma.associate.update({
      where: { id: associateId },
      data: {
        resetCodeHash: null,
        resetCodeExpiresAt: null,
        resetCodeAttempts: 0,
      },
    });
  }

  /**
   * Reset feito pelo operador no painel: gera uma senha temporária ditável e
   * devolve UMA única vez (no banco fica só o hash). O cliente entra com ela e
   * o app obriga a criar a senha definitiva.
   *
   * É o caminho que funciona sempre — sem depender de WhatsApp, telefone
   * cadastrado ou aprovação de template.
   */
  async resetPasswordByOperator(
    associateId: string,
    tenantId: string,
  ): Promise<{ name: string; temporaryPassword: string }> {
    const associate = await this.prisma.associate.findFirst({
      where: { id: associateId, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!associate) {
      throw new NotFoundException('Cliente não encontrado');
    }

    const senha = gerarSenhaDitavel();
    await this.prisma.associate.update({
      where: { id: associate.id },
      data: {
        password: await bcrypt.hash(senha, BCRYPT_ROUNDS),
        // Temporária: o app exige a troca no primeiro acesso.
        mustChangePassword: true,
        resetCodeHash: null,
        resetCodeExpiresAt: null,
        resetCodeAttempts: 0,
      },
    });

    this.logger.log(
      `Senha temporária gerada pelo painel para o cliente ${associate.name}.`,
    );
    return { name: associate.name, temporaryPassword: senha };
  }

  /**
   * Define/redefine a senha de um associado (uso operacional/admin).
   * Normaliza o CPF e exige que o associado exista e não esteja deletado.
   */
  async setPasswordByCpf(rawCpf: string, plainPassword: string) {
    const cpf = normalizeDoc(rawCpf);
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
