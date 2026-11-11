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

/**
 * Avisos de rastreador pelo número de disparo da 21 Go (21 98481-6000).
 * Desligado enquanto WHATSAPP_DISPARO_TOKEN/PHONE_NUMBER_ID não estiverem
 * definidos. Nunca lança: a ativação já foi gravada quando isto roda.
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

    try {
      await axios.post(
        `https://graph.facebook.com/${versao}/${phoneNumberId}/messages`,
        {
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
        },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000 },
      );
      this.logger.log(
        `Aviso de instalação da placa ${aviso.placa} enviado para ${WhatsappService.mascarar(numero)}.`,
      );
      return true;
    } catch (erro) {
      const resposta = (erro as { response?: { status?: number; data?: { error?: { message?: string } } } })
        .response;
      this.logger.error(
        `Aviso de instalação da placa ${aviso.placa} falhou: status ${resposta?.status ?? '-'} ${
          resposta?.data?.error?.message ?? (erro instanceof Error ? erro.message : '')
        }`,
      );
      return false;
    }
  }
}
