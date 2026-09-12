import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface BoletoDoCrm {
  nossoNumero: string;
  placa: string | null;
  mesReferente: string | null;
  valor: number | null;
  vencimento: string | null;
  status: string;
  linhaDigitavel: string | null;
  linkPdf: string | null;
}

export interface ResultadoCrm {
  boletos: BoletoDoCrm[];
  // null = o CRM não mandou o campo — diferente de mandar 0. Quem grava o
  // espelho não pode rebaixar em silêncio uma contagem financeira real
  // (achado do portão final).
  foraDoPrazo: number | null;
}

@Injectable()
export class CrmBoletosClient {
  private readonly logger = new Logger(CrmBoletosClient.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Lista do CRM. `null` = não deu para confirmar nada (env faltando, HTTP
   * não-2xx, erro de rede, resposta fora do contrato) — DIFERENTE de uma
   * lista vazia legítima (associado em dia). Confundir os dois faz o robô
   * apagar o espelho de quem deve, achado C1 da revisão final: quem chama
   * decide o que fazer com `null`, mas nunca é "apagar tudo".
   */
  async buscarPorCpf(cpf: string): Promise<ResultadoCrm | null> {
    const base = this.config.get<string>('crm.baseUrl');
    const token = this.config.get<string>('crm.token');
    if (!base || !token) return null;
    try {
      // CPF vai no header x-cpf, não mais na querystring — o CRM mudou de
      // contrato e loga req.url; CPF em claro no log era o achado 3 de lá.
      const r = await fetch(`${base}/integracao/boletos`, {
        headers: { Authorization: `Bearer ${token}`, 'x-cpf': cpf },
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) {
        this.logger.warn(`CRM respondeu ${r.status} ao listar boletos`);
        return null;
      }
      const body = (await r.json()) as { boletos?: BoletoDoCrm[]; foraDoPrazo?: number };
      if (!Array.isArray(body.boletos)) return null;
      return {
        boletos: body.boletos,
        foraDoPrazo: typeof body.foraDoPrazo === 'number' ? body.foraDoPrazo : null,
      };
    } catch (err) {
      this.logger.warn(`CRM indisponível: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Baixa o PDF. O link da Hinova responde 200 mesmo morto, com HTML de erro no
   * corpo — por isso quem prova é o conteúdo, não o status (medido no CRM, 07/08/2026).
   */
  async baixarPdf(url: string): Promise<Buffer | null> {
    try {
      // ~3,4 MB por boleto a 400 kbps ≈ 68s; 60s cortava o cenário ruim que precisa cobrir.
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      return buf.subarray(0, 4).toString() === '%PDF' ? buf : null;
    } catch (err) {
      this.logger.warn(`falhou ao baixar PDF: ${(err as Error).message}`);
      return null;
    }
  }
}
