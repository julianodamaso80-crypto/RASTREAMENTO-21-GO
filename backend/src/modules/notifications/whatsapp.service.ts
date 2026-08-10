import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export type WhatsappProvider = 'meta' | 'evolution' | 'none';

export interface EnvioResultado {
  enviado: boolean;
  motivo?: string;
}

/**
 * Envio de WhatsApp com dois caminhos possíveis, escolhidos por env:
 *
 * - `meta`      → WhatsApp Cloud API oficial (graph.facebook.com). Código de
 *                 verificação EXIGE template da categoria AUTHENTICATION
 *                 aprovado previamente; o texto é preset da Meta
 *                 ("<CÓDIGO> is your verification code") e só o código varia.
 * - `evolution` → Evolution API (a mesma instância que já roda no droplet).
 *                 Texto livre, sem aprovação — bom pra teste e contingência.
 * - `none`      → desligado. O fluxo de recuperação responde que não conseguiu
 *                 enviar e orienta procurar a associação (o reset pelo painel
 *                 continua funcionando).
 *
 * Nunca lança: quem chama trata `enviado: false` e mostra o caminho alternativo.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private config: ConfigService) {}

  get provider(): WhatsappProvider {
    return (this.config.get<string>('whatsapp.provider') ||
      'none') as WhatsappProvider;
  }

  get habilitado(): boolean {
    return this.provider !== 'none';
  }

  /**
   * Normaliza pro formato que a Meta espera: só dígitos, com DDI.
   * Aceita "21 99999-9999", "(21)99999-9999", "5521999999999".
   * Assume Brasil quando o DDI não veio — a base é toda nacional.
   */
  static normalizarNumero(bruto: string): string | null {
    const digitos = (bruto || '').replace(/\D/g, '');
    if (digitos.length < 10) return null;
    if (digitos.startsWith('55') && digitos.length >= 12) return digitos;
    if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
    return digitos;
  }

  /** Mostra só o final do número na tela: "(21) *****-4321". */
  static mascarar(bruto: string): string {
    const d = (bruto || '').replace(/\D/g, '');
    if (d.length < 4) return '***';
    return `*****-${d.slice(-4)}`;
  }

  /**
   * Envia o código de verificação. Mantém o código FORA do log — nem em debug.
   */
  async enviarCodigo(
    telefone: string,
    codigo: string,
    minutosValidade: number,
  ): Promise<EnvioResultado> {
    const numero = WhatsappService.normalizarNumero(telefone);
    if (!numero) {
      return { enviado: false, motivo: 'telefone inválido' };
    }

    try {
      switch (this.provider) {
        case 'meta':
          return await this.viaMeta(numero, codigo, minutosValidade);
        case 'evolution':
          return await this.viaEvolution(numero, codigo, minutosValidade);
        default:
          return { enviado: false, motivo: 'WhatsApp não configurado' };
      }
    } catch (erro) {
      // Só o status/mensagem — nunca o corpo, que pode ecoar o código.
      const status = (erro as { response?: { status?: number } }).response
        ?.status;
      this.logger.error(
        `Falha ao enviar WhatsApp (${this.provider}) para ${WhatsappService.mascarar(numero)}: status ${status ?? '-'} ${
          erro instanceof Error ? erro.message : ''
        }`,
      );
      return { enviado: false, motivo: 'falha no envio' };
    }
  }

  /**
   * WhatsApp Cloud API oficial.
   * POST https://graph.facebook.com/{versao}/{phoneNumberId}/messages
   *
   * O componente `button` só vai quando o template foi criado com botão
   * COPY_CODE/ONE_TAP — configurável, porque template sem botão recusa o
   * componente e template com botão exige.
   */
  private async viaMeta(
    numero: string,
    codigo: string,
    minutosValidade: number,
  ): Promise<EnvioResultado> {
    const token = this.config.get<string>('whatsapp.meta.token');
    const phoneNumberId = this.config.get<string>('whatsapp.meta.phoneNumberId');
    const template = this.config.get<string>('whatsapp.meta.template');
    const idioma = this.config.get<string>('whatsapp.meta.language') || 'pt_BR';
    const versao = this.config.get<string>('whatsapp.meta.apiVersion') || 'v21.0';
    const comBotao = this.config.get<string>('whatsapp.meta.copyCodeButton') !== 'false';

    if (!token || !phoneNumberId || !template) {
      return {
        enviado: false,
        motivo: 'credenciais da Meta ausentes (token/phoneNumberId/template)',
      };
    }

    const components: unknown[] = [
      { type: 'body', parameters: [{ type: 'text', text: codigo }] },
    ];
    if (comBotao) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: codigo }],
      });
    }

    await axios.post(
      `https://graph.facebook.com/${versao}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: numero,
        type: 'template',
        template: {
          name: template,
          language: { code: idioma },
          components,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      },
    );

    this.logger.log(
      `Código enviado via Meta para ${WhatsappService.mascarar(numero)} (validade ${minutosValidade}min).`,
    );
    return { enviado: true };
  }

  /** Evolution API — texto livre, sem template aprovado. */
  private async viaEvolution(
    numero: string,
    codigo: string,
    minutosValidade: number,
  ): Promise<EnvioResultado> {
    const url = this.config.get<string>('whatsapp.evolution.url');
    const apiKey = this.config.get<string>('whatsapp.evolution.apiKey');
    const instancia = this.config.get<string>('whatsapp.evolution.instance');

    if (!url || !apiKey || !instancia) {
      return {
        enviado: false,
        motivo: 'credenciais da Evolution ausentes (url/apiKey/instance)',
      };
    }

    await axios.post(
      `${url.replace(/\/$/, '')}/message/sendText/${instancia}`,
      {
        number: numero,
        text:
          `*${codigo}* é o seu código para criar uma nova senha no app 21GO Rastreamento.\n\n` +
          `Vale por ${minutosValidade} minutos. Não compartilhe com ninguém — ` +
          `nossa equipe nunca pede esse código.`,
      },
      {
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        timeout: 15_000,
      },
    );

    this.logger.log(
      `Código enviado via Evolution para ${WhatsappService.mascarar(numero)} (validade ${minutosValidade}min).`,
    );
    return { enviado: true };
  }
}
