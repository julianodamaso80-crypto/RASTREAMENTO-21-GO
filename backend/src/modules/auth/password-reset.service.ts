import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { WhatsappService } from '../notifications/whatsapp.service';

const BCRYPT_ROUNDS = 10;

/** O que o motor precisa saber sobre quem está recuperando a senha. */
export interface SujeitoReset {
  id: string;
  phone: string | null;
  resetCodeHash: string | null;
  resetCodeExpiresAt: Date | null;
  resetCodeAttempts: number;
  resetCodeSentAt: Date | null;
}

/** Como o motor lê e grava — cada mundo implementa sobre a sua tabela. */
export interface RepositorioReset {
  buscar(identificador: string): Promise<SujeitoReset | null>;
  gravarCodigo(id: string, hash: string, expiraEm: Date): Promise<void>;
  contarTentativa(id: string): Promise<void>;
  limparCodigo(id: string): Promise<void>;
  gravarSenha(id: string, hash: string): Promise<void>;
}

export interface RespostaEnvio {
  message: string;
  sentTo: string | null;
  canUseWhatsapp: boolean;
}

/**
 * Recuperação de senha por código de 6 dígitos no WhatsApp.
 *
 * Motor único do site, do app do associado e do PWA do técnico. Nasceu dentro
 * do `AssociateAuthService` e foi extraído sem mudar uma trava sequer.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  /** Validade do código. Curta de propósito: código vivo é código atacável. */
  static readonly CODIGO_VALIDADE_MIN = 15;
  /** Tentativas erradas antes de o código morrer. */
  static readonly CODIGO_MAX_TENTATIVAS = 5;
  /** Espaçamento mínimo entre envios pro mesmo identificador. */
  static readonly CODIGO_INTERVALO_MIN = 2;

  constructor(private readonly whatsapp: WhatsappService) {}

  /**
   * Gera e envia o código.
   *
   * A resposta é SEMPRE a mesma, exista ou não o cadastro: senão a rota vira
   * verificador de "esse CPF é cliente de vocês?" pra qualquer um na internet.
   * O telefone volta mascarado só quando o envio aconteceu de fato.
   */
  async enviarCodigo(
    repo: RepositorioReset,
    identificador: string,
    rotulo: string,
  ): Promise<RespostaEnvio> {
    const generico: RespostaEnvio = {
      message:
        `Se esse ${rotulo} estiver cadastrado, enviamos um código no WhatsApp. ` +
        'Não chegou em alguns minutos? Fale com a sua associação.',
      sentTo: null,
      canUseWhatsapp: this.whatsapp.habilitado,
    };

    const sujeito = await repo.buscar(identificador);
    if (!sujeito?.phone) {
      if (sujeito) {
        this.logger.warn(
          `Recuperação pedida sem telefone cadastrado (${rotulo}).`,
        );
      }
      return generico;
    }

    if (sujeito.resetCodeSentAt) {
      const desdeUltimo = Date.now() - sujeito.resetCodeSentAt.getTime();
      if (desdeUltimo < PasswordResetService.CODIGO_INTERVALO_MIN * 60 * 1000) {
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
      Date.now() + PasswordResetService.CODIGO_VALIDADE_MIN * 60 * 1000,
    );
    await repo.gravarCodigo(
      sujeito.id,
      await bcrypt.hash(codigo, BCRYPT_ROUNDS),
      expiraEm,
    );

    const envio = await this.whatsapp.enviarCodigo(
      sujeito.phone,
      codigo,
      PasswordResetService.CODIGO_VALIDADE_MIN,
    );
    if (!envio.enviado) {
      this.logger.warn(
        `Não consegui enviar o código (${rotulo}): ${envio.motivo}`,
      );
      return {
        message:
          'No momento não consigo enviar o código pelo WhatsApp. ' +
          'Fale com a sua associação para redefinir a sua senha.',
        sentTo: null,
        canUseWhatsapp: false,
      };
    }

    return { ...generico, sentTo: WhatsappService.mascarar(sujeito.phone) };
  }

  /**
   * Confere o código e grava a senha nova.
   *
   * Erros aqui são específicos de propósito (código errado x expirado): quem
   * chega nesta etapa já provou ter o WhatsApp do titular, e mensagem vaga só
   * atrapalharia quem é legítimo.
   */
  async redefinirSenha(
    repo: RepositorioReset,
    identificador: string,
    codigo: string,
    novaSenha: string,
    validarSenha?: (senha: string) => void,
  ): Promise<{ ok: true }> {
    const digitos = (codigo || '').replace(/\D/g, '');
    const sujeito = await repo.buscar(identificador);

    const invalido = new UnauthorizedException(
      'Código inválido ou expirado. Peça um novo código.',
    );
    if (!sujeito?.resetCodeHash || !sujeito.resetCodeExpiresAt) throw invalido;

    if (sujeito.resetCodeExpiresAt.getTime() < Date.now()) {
      await repo.limparCodigo(sujeito.id);
      throw invalido;
    }
    if (
      sujeito.resetCodeAttempts >= PasswordResetService.CODIGO_MAX_TENTATIVAS
    ) {
      await repo.limparCodigo(sujeito.id);
      throw new UnauthorizedException(
        'Muitas tentativas erradas. Peça um novo código.',
      );
    }

    if (!(await bcrypt.compare(digitos, sujeito.resetCodeHash))) {
      // Conta a tentativa ANTES de responder — senão força bruta é de graça.
      await repo.contarTentativa(sujeito.id);
      if (
        sujeito.resetCodeAttempts + 1 >=
        PasswordResetService.CODIGO_MAX_TENTATIVAS
      ) {
        await repo.limparCodigo(sujeito.id);
      }
      throw invalido;
    }

    validarSenha?.(novaSenha);
    if (novaSenha.trim().length < 6) {
      throw new BadRequestException(
        'A nova senha precisa ter ao menos 6 caracteres.',
      );
    }

    await repo.gravarSenha(
      sujeito.id,
      await bcrypt.hash(novaSenha, BCRYPT_ROUNDS),
    );
    await repo.limparCodigo(sujeito.id);
    this.logger.log(
      `Senha redefinida por código (final ${identificador.slice(-4)}).`,
    );
    return { ok: true };
  }
}
