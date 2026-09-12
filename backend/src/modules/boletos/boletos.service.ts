import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TELEFONE_SETOR_BOLETOS, aindaPodePagar, rotuloVencimento } from './boletos.regras';

export type BoletoDaAba = {
  id: string;
  placa: string | null;
  mesReferente: string | null;
  valor: number | null;
  vencimento: string | null;
  rotulo: string;
  linhaDigitavel: string | null;
  temPdf: boolean;
};

@Injectable()
export class BoletosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lê SÓ do espelho local — nunca chama CRM nem SGA. É isso que faz a aba
   * funcionar no sábado, quando a credencial da Hinova está recusada.
   */
  async listarDoAssociado(
    associateId: string,
    tenantId: string,
    agora: Date = new Date(),
  ): Promise<{
    boletos: BoletoDaAba[];
    pendente: boolean;
    rodape: typeof TELEFONE_SETOR_BOLETOS;
    foraDoPrazo: number;
  }> {
    const [associado, linhas] = await Promise.all([
      this.prisma.associate.findFirst({
        where: { id: associateId, tenantId },
        select: { boletosSincronizadosEm: true, boletosForaDoPrazo: true },
      }),
      this.prisma.associateBoleto.findMany({
        where: { tenantId, associateId, status: { notIn: ['pago', 'cancelado'] } },
        orderBy: { vencimento: 'asc' },
      }),
    ]);

    // Allowlist explícita: o objeto é montado campo a campo, nunca espalhado.
    const linhasNoPrazo = linhas.filter((l) => aindaPodePagar(l.vencimento, agora));
    const boletos = linhasNoPrazo.map((l) => ({
      id: l.id,
      placa: l.plate ?? null,
      mesReferente: l.mesReferente ?? null,
      valor: l.valor != null ? Number(l.valor) : null,
      vencimento: l.vencimento ?? null,
      rotulo: rotuloVencimento(l.vencimento, agora),
      linhaDigitavel: l.linhaDigitavel ?? null,
      temPdf: (l.pdfBytes ?? 0) > 0,
    }));

    // Linha que passou dos 5 dias agora, entre uma rodada do robô e outra: o
    // espelho ainda guarda o boleto, mas ele já não pode aparecer na lista.
    // Sem somar aqui, o associado lia "em dia" até a próxima rodada (até 56h
    // num boleto que vence o 6º dia num sábado). Não conta duas vezes: o
    // valor guardado só cobre linhas que o CRM já apagou do espelho.
    const foraDoPrazoLocal = linhas.length - linhasNoPrazo.length;

    /**
     * Lista vazia tem DOIS significados, e confundi-los é grave: dizer "você está
     * em dia" a quem o robô nunca visitou é mentir para quem deve. NULL = nunca
     * visitado, e a tela escreve que os boletos aparecem a partir de segunda.
     */
    return {
      boletos,
      pendente: !associado?.boletosSincronizadosEm,
      rodape: TELEFONE_SETOR_BOLETOS,
      // Boleto que o CRM já não emite mais por atraso > 5 dias: sem isto,
      // "sem boleto" não diferenciava "está em dia" de "tem pendência velha"
      // (achado C3).
      foraDoPrazo: (associado?.boletosForaDoPrazo ?? 0) + foraDoPrazoLocal,
    };
  }

  /** Só o que a carga precisa. Não devolve nada além disto. */
  async dadosParaSincronizar(
    associateId: string,
    tenantId: string,
  ): Promise<{ id: string; tenantId: string; cpf: string | null } | null> {
    const a = await this.prisma.associate.findFirst({
      where: { id: associateId, tenantId, deletedAt: null },
      select: { id: true, tenantId: true, cpf: true },
    });
    return a ?? null;
  }

  /** O PDF guardado. Confere dono antes de entregar: id sozinho nunca basta. */
  async pdfDoBoleto(id: string, associateId: string, tenantId: string): Promise<Buffer | null> {
    const boleto = await this.prisma.associateBoleto.findFirst({
      where: { id, tenantId, associateId },
      select: { nossoNumero: true },
    });
    if (!boleto) return null;
    const pdf = await this.prisma.associateBoletoPdf.findFirst({
      where: { nossoNumero: boleto.nossoNumero, tenantId },
      select: { conteudo: true },
    });
    return pdf ? Buffer.from(pdf.conteudo) : null;
  }
}
