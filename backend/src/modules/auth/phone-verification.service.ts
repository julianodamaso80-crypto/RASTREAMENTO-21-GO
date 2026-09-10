import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../notifications/whatsapp.service';

const BCRYPT_ROUNDS = 10;
const VALIDADE_MIN = 15;
const MAX_TENTATIVAS = 5;

/** Qual cadastro está sendo verificado. */
export type MundoVerificavel = 'user' | 'technician';

/** Só o recorte da tabela que este serviço usa — o resto do Prisma não importa. */
interface TabelaVerificavel {
  findFirst(args: unknown): Promise<Record<string, unknown> | null>;
  update(args: unknown): Promise<unknown>;
}

/**
 * Cadastro e confirmação do WhatsApp no login.
 *
 * O número informado fica em `pendingPhone` até o código conferir — assim um
 * número digitado errado nunca substitui o telefone bom que já estava lá, e o
 * código de recuperação nunca passa a ir para o aparelho de outra pessoa.
 */
@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

  private tabela(mundo: MundoVerificavel): TabelaVerificavel {
    return (
      mundo === 'user' ? this.prisma.user : this.prisma.technician
    ) as unknown as TabelaVerificavel;
  }

  /** Manda o código para o número informado e guarda como pendente. */
  async iniciar(mundo: MundoVerificavel, id: string, telefone: string) {
    const numero = WhatsappService.normalizarNumero(telefone);
    if (!numero) {
      throw new BadRequestException('Informe um número de WhatsApp com DDD.');
    }

    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.tabela(mundo).update({
      where: { id },
      data: {
        pendingPhone: numero,
        resetCodeHash: await bcrypt.hash(codigo, BCRYPT_ROUNDS),
        resetCodeExpiresAt: new Date(Date.now() + VALIDADE_MIN * 60 * 1000),
        resetCodeAttempts: 0,
        resetCodeSentAt: new Date(),
      },
    });

    const envio = await this.whatsapp.enviarCodigo(numero, codigo, VALIDADE_MIN);
    if (!envio.enviado) {
      this.logger.warn(`Não consegui enviar o código de verificação: ${envio.motivo}`);
      throw new BadRequestException(
        'Não consegui enviar o código para esse número. Confira e tente de novo.',
      );
    }
    return { sentTo: WhatsappService.mascarar(numero) };
  }

  /** Confere o código e promove o número pendente a verificado. */
  async confirmar(mundo: MundoVerificavel, id: string, codigo: string) {
    const registro = await this.tabela(mundo).findFirst({
      where: { id },
      select: {
        id: true,
        pendingPhone: true,
        resetCodeHash: true,
        resetCodeExpiresAt: true,
        resetCodeAttempts: true,
      },
    });

    const invalido = new UnauthorizedException(
      'Código inválido ou expirado. Peça um novo código.',
    );
    const hash = registro?.resetCodeHash as string | null | undefined;
    const pendente = registro?.pendingPhone as string | null | undefined;
    const expiraEm = registro?.resetCodeExpiresAt as Date | null | undefined;
    const tentativas = (registro?.resetCodeAttempts as number) ?? 0;

    if (!hash || !pendente) throw invalido;
    if (!expiraEm || expiraEm.getTime() < Date.now()) throw invalido;
    if (tentativas >= MAX_TENTATIVAS) {
      throw new UnauthorizedException(
        'Muitas tentativas erradas. Peça um novo código.',
      );
    }

    if (!(await bcrypt.compare((codigo || '').replace(/\D/g, ''), hash))) {
      // Conta a tentativa ANTES de responder — senão força bruta é de graça.
      await this.tabela(mundo).update({
        where: { id },
        data: { resetCodeAttempts: { increment: 1 } },
      });
      throw invalido;
    }

    await this.tabela(mundo).update({
      where: { id },
      data: {
        phone: pendente,
        phoneVerifiedAt: new Date(),
        pendingPhone: null,
        resetCodeHash: null,
        resetCodeExpiresAt: null,
        resetCodeAttempts: 0,
      },
    });
    this.logger.log(`WhatsApp verificado (${mundo}).`);
    return { ok: true };
  }
}
