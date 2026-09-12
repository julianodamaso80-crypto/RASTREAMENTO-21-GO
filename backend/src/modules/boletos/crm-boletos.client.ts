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

@Injectable()
export class CrmBoletosClient {
  private readonly logger = new Logger(CrmBoletosClient.name);

  constructor(
    private readonly config: ConfigService,
    private readonly buscar: typeof fetch = fetch,
  ) {}

  /** Lista do CRM. Qualquer falha vira lista vazia: a aba mostra o que já tem guardado. */
  async buscarPorCpf(cpf: string): Promise<BoletoDoCrm[]> {
    const base = this.config.get<string>('crm.baseUrl');
    const token = this.config.get<string>('crm.token');
    if (!base || !token) return [];
    try {
      const r = await this.buscar(`${base}/integracao/boletos?cpf=${encodeURIComponent(cpf)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) {
        this.logger.warn(`CRM respondeu ${r.status} ao listar boletos`);
        return [];
      }
      const body = (await r.json()) as { boletos?: BoletoDoCrm[] };
      return body.boletos ?? [];
    } catch (err) {
      this.logger.warn(`CRM indisponível: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Baixa o PDF. O link da Hinova responde 200 mesmo morto, com HTML de erro no
   * corpo — por isso quem prova é o conteúdo, não o status (medido no CRM, 07/08/2026).
   */
  async baixarPdf(url: string): Promise<Buffer | null> {
    try {
      const r = await this.buscar(url, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      return buf.subarray(0, 4).toString() === '%PDF' ? buf : null;
    } catch (err) {
      this.logger.warn(`falhou ao baixar PDF: ${(err as Error).message}`);
      return null;
    }
  }
}
