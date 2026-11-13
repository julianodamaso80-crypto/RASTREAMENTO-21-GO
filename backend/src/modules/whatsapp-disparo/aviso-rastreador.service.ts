import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WhatsappService } from '../notifications/whatsapp.service';

export interface AvisoInstalacao {
  telefone: string | null | undefined;
  nome: string | null | undefined;
  /** Modelo como vem do SGA, ex.: "GOL 1.0 MI TOTAL FLEX 8V 4P". */
  modelo: string | null | undefined;
  placa: string;
}

function titulo(palavra: string): string {
  return palavra.charAt(0).toUpperCase() + palavra.slice(1).toLowerCase();
}

/**
 * Variáveis do template: primeiro nome, veículo e placa. A Meta recusa
 * variável vazia, por isso todas têm um valor neutro de reserva.
 */
export function parametrosInstalado(a: AvisoInstalacao): [string, string, string] {
  const nome = (a.nome || '').trim().split(/\s+/)[0];
  const modelo = (a.modelo || '').trim().split(/\s+/)[0];
  return [nome ? titulo(nome) : 'cliente', modelo ? titulo(modelo) : 'veículo', a.placa];
}

/** Tentativas por aviso e a espera antes da 2ª e da 3ª. */
const ESPERAS_MS = [2_000, 8_000];

/** Rede caiu ANTES de a Meta receber o pedido: repetir não duplica a mensagem. */
const REDE_NAO_CHEGOU = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

/**
 * Vale tentar de novo? Só quando é certo que a mensagem NÃO saiu: a Meta
 * respondeu 429/5xx, ou a conexão nem abriu. Resposta que não voltou
 * (ECONNABORTED, ECONNRESET) fica de fora de propósito — a Meta pode ter
 * aceitado, e repetir mandaria o aviso duas vezes para o cliente.
 */
export function erroTransitorio(erro: unknown): boolean {
  const e = erro as { code?: string; response?: { status?: number } };
  const status = e?.response?.status;
  if (status) return status === 429 || status >= 500;
  return REDE_NAO_CHEGOU.has(e?.code ?? '');
}

/**
 * Avisos de rastreador pelo número de disparo da 21 Go (21 98481-6000).
 * Desligado enquanto WHATSAPP_DISPARO_TOKEN/PHONE_NUMBER_ID não estiverem
 * definidos. Nunca lança: a ativação já foi gravada quando isto roda.
 *
 * As tentativas ficam em memória: se o container reiniciar no meio da espera,
 * o aviso daquele cliente se perde (a ativação não).
 */
@Injectable()
export class AvisoRastreadorService {
  private readonly logger = new Logger(AvisoRastreadorService.name);

  constructor(private config: ConfigService) {}

  async avisarInstalado(aviso: AvisoInstalacao): Promise<boolean> {
    const token = this.config.get<string>('whatsappDisparo.token');
    const phoneNumberId = this.config.get<string>('whatsappDisparo.phoneNumberId');
    const template = this.config.get<string>('whatsappDisparo.templateInstalado');
    const versao = this.config.get<string>('whatsappDisparo.apiVersion');
    if (!token || !phoneNumberId || !template) return false;

    const numero = WhatsappService.normalizarNumero(aviso.telefone || '');
    if (!numero) {
      this.logger.warn(`Aviso de instalação da placa ${aviso.placa} não enviado: cliente sem telefone.`);
      return false;
    }

    const corpo = {
      messaging_product: 'whatsapp',
      to: numero,
      type: 'template',
      template: {
        name: template,
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: parametrosInstalado(aviso).map((text) => ({ type: 'text', text })),
          },
        ],
      },
    };

    for (let tentativa = 1; ; tentativa++) {
      try {
        await axios.post(`https://graph.facebook.com/${versao}/${phoneNumberId}/messages`, corpo, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15_000,
        });
        // warn e não log: em produção o nível é 'warn', e sem esta linha não
        // há como saber quantos avisos saíram.
        this.logger.warn(
          `Aviso de instalação da placa ${aviso.placa} enviado para ${WhatsappService.mascarar(numero)} (tentativa ${tentativa}).`,
        );
        return true;
      } catch (erro) {
        const resposta = (erro as { response?: { status?: number; data?: { error?: { message?: string } } } })
          .response;
        const motivo = `status ${resposta?.status ?? '-'} ${
          resposta?.data?.error?.message ?? (erro instanceof Error ? erro.message : '')
        }`;
        const espera = ESPERAS_MS[tentativa - 1];
        if (espera === undefined || !erroTransitorio(erro)) {
          this.logger.error(
            `Aviso de instalação da placa ${aviso.placa} NÃO enviado após ${tentativa} tentativa(s): ${motivo}`,
          );
          return false;
        }
        this.logger.warn(
          `Aviso de instalação da placa ${aviso.placa} falhou na tentativa ${tentativa} (${motivo}); nova tentativa em ${espera / 1000}s.`,
        );
        await this.esperar(espera);
      }
    }
  }

  protected esperar(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
