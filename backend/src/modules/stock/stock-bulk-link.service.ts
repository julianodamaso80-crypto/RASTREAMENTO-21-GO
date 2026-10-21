import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';
import {
  agruparItensEmLinhas,
  linhasDaTabela,
  MSG_CABECALHO,
  tamanhoDeImeiOuTag,
  type ItemTexto,
  type LinhaVinculo,
  type TabelaLida,
} from './bulk-link-parser';
import type { BulkLinkRowDto } from './dto/bulk-link.dto';

// pdf-parse 1.x: o index.js tenta abrir um PDF de teste quando importado sem
// `module.parent`; o arquivo da lib evita isso.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

export type StatusVinculo = 'VINCULADO' | 'JA_VINCULADO' | 'ERRO';

export interface ResultadoVinculo {
  linha: number;
  placa: string;
  imei: string;
  status: StatusVinculo;
  motivo?: string;
}

@Injectable()
export class StockBulkLinkService {
  private readonly logger = new Logger(StockBulkLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  async ler(buffer: Buffer, nomeArquivo: string): Promise<TabelaLida> {
    const nome = nomeArquivo.toLowerCase();
    let matriz: string[][];
    if (nome.endsWith('.pdf')) {
      matriz = await this.matrizDoPdf(buffer);
    } else if (nome.endsWith('.xlsx')) {
      matriz = await this.matrizDaPlanilha(buffer);
    } else {
      throw new BadRequestException(
        'Formato não aceito. Envie uma planilha .xlsx ou um PDF.',
      );
    }
    const lida = linhasDaTabela(matriz);
    if (!lida.erroGeral && lida.linhas.length === 0) {
      return { linhas: [], erroGeral: 'O arquivo não tem nenhuma linha de dados.' };
    }
    return lida;
  }

  /**
   * Vincula cada linha ao SGA pelo mesmo `associate` do botão manual — mesmas
   * regras (associado ativo, IMEI livre, placa sem outro rastreador). Uma linha
   * que falha nunca derruba as outras; o motivo volta na própria linha.
   * `allowInactive` fica sempre falso: liberar associado inativo é decisão
   * individual de administrador, não de importação em lote.
   */
  async vincular(
    tenantId: string,
    linhas: BulkLinkRowDto[],
  ): Promise<ResultadoVinculo[]> {
    const resultados: ResultadoVinculo[] = [];
    for (const l of linhas) {
      resultados.push(await this.vincularUma(tenantId, l));
    }
    return resultados;
  }

  private async vincularUma(
    tenantId: string,
    l: BulkLinkRowDto,
  ): Promise<ResultadoVinculo> {
    const base = { linha: l.linha, placa: l.placa, imei: l.imei };
    if (!/^\d+$/.test(l.imei) || !tamanhoDeImeiOuTag(l.imei)) {
      return {
        ...base,
        status: 'ERRO',
        motivo: 'IMEI precisa ter 15 dígitos (TAG: ID de 10 ou 11 dígitos).',
      };
    }
    // ID curto só vale se já for uma TAG do Estoque: não criamos item novo a
    // partir dele, senão erro de digitação viraria lixo no estoque.
    const ehTag = l.imei.length !== 15;

    let criadoAgora = false;
    let itemId: string | null = null;
    try {
      const existente = await this.prisma.stockItem.findFirst({
        where: {
          tenantId,
          imei: l.imei,
          deletedAt: null,
          ...(ehTag ? { kind: 'TAG' } : {}),
        },
      });

      if (ehTag && !existente) {
        return {
          ...base,
          status: 'ERRO',
          motivo: `O ID ${l.imei} não está no Estoque como TAG. Confira o número ou importe a TAG antes.`,
        };
      }

      if (existente?.associatedAt) {
        return await this.jaAssociado(tenantId, base);
      }

      if (existente) {
        itemId = existente.id;
      } else {
        // Não estava no estoque: entra agora (é o "importar em massa"). Se o
        // vínculo falhar, sai de novo logo abaixo, para erro de digitação de
        // IMEI não virar lixo no estoque.
        const item = await this.prisma.stockItem.upsert({
          where: { tenantId_imei: { tenantId, imei: l.imei } },
          create: { tenantId, imei: l.imei },
          update: { deletedAt: null },
        });
        itemId = item.id;
        criadoAgora = true;
      }

      await this.stock.associate(
        itemId,
        tenantId,
        {
          placa: l.placa,
          technicianName: l.tecnico,
          installLocation: l.local,
        },
        false,
      );
      return { ...base, status: 'VINCULADO' };
    } catch (erro) {
      if (criadoAgora && itemId) {
        await this.prisma.stockItem
          .update({ where: { id: itemId }, data: { deletedAt: new Date() } })
          .catch(() => undefined);
      }
      return { ...base, status: 'ERRO', motivo: this.motivoDoErro(erro, l) };
    }
  }

  /** IMEI que já foi vinculado: mesma placa é repetição; outra placa é conflito. */
  private async jaAssociado(
    tenantId: string,
    base: { linha: number; placa: string; imei: string },
  ): Promise<ResultadoVinculo> {
    const device = await this.prisma.device.findFirst({
      where: { tenantId, imei: base.imei },
      select: { vehicle: { select: { plate: true, chassi: true } } },
    });
    const instaladoEm = device?.vehicle?.plate || device?.vehicle?.chassi || null;
    const mesma =
      instaladoEm &&
      [device?.vehicle?.plate, device?.vehicle?.chassi]
        .filter(Boolean)
        .some((v) => v!.toUpperCase().replace(/[^A-Z0-9]/g, '') === base.placa);
    if (mesma) {
      return {
        ...base,
        status: 'JA_VINCULADO',
        motivo: 'Já estava vinculado a esta placa; nada foi alterado.',
      };
    }
    return {
      ...base,
      status: 'ERRO',
      motivo: instaladoEm
        ? `Este IMEI já está instalado na placa ${instaladoEm}. Desvincule antes de usar em outra.`
        : 'Este IMEI já foi associado a um cliente. Confira o cadastro.',
    };
  }

  private motivoDoErro(erro: unknown, l: BulkLinkRowDto): string {
    if (erro instanceof HttpException) {
      const r = erro.getResponse();
      const msg =
        typeof r === 'string'
          ? r
          : (r as { message?: string | string[] }).message;
      const texto = Array.isArray(msg) ? msg.join('; ') : msg;
      return texto || erro.message;
    }
    this.logger.error(
      `Vínculo em massa, linha ${l.linha} (IMEI ${l.imei}, placa ${l.placa}): ${
        erro instanceof Error ? erro.stack || erro.message : erro
      }`,
    );
    return `Erro inesperado ao vincular (${
      erro instanceof Error ? erro.message : 'sem detalhe'
    }). Tente de novo; se repetir, avise o suporte.`;
  }

  private async matrizDaPlanilha(buffer: Buffer): Promise<string[][]> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException(
        'Arquivo inválido. Envie uma planilha .xlsx válida.',
      );
    }
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 2) {
      throw new BadRequestException('Planilha vazia ou sem dados.');
    }
    const matriz: string[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const celulas: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        celulas.push(this.textoDaCelula(row.getCell(c)));
      }
      matriz.push(celulas);
    }
    return matriz;
  }

  private textoDaCelula(cell: ExcelJS.Cell): string {
    const v = cell?.value;
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') {
      // Número grande (IMEI) sem notação científica.
      return Number.isInteger(v) ? v.toLocaleString('fullwide', { useGrouping: false }) : String(v);
    }
    if (typeof v === 'object') {
      const o = v as unknown as Record<string, unknown>;
      if (o.text != null) return String(o.text).trim();
      if (o.result != null) return String(o.result).trim();
      if (Array.isArray(o.richText)) {
        return (o.richText as Array<{ text: string }>)
          .map((t) => t.text)
          .join('')
          .trim();
      }
    }
    return String(v).trim();
  }

  private async matrizDoPdf(buffer: Buffer): Promise<string[][]> {
    const matriz: string[][] = [];
    try {
      await pdfParse(buffer, {
        pagerender: async (pagina: {
          getTextContent: (o: object) => Promise<{
            items: Array<{ str: string; transform: number[]; width: number }>;
          }>;
        }) => {
          const conteudo = await pagina.getTextContent({
            normalizeWhitespace: true,
          });
          const itens: ItemTexto[] = conteudo.items.map((i) => ({
            str: i.str,
            x: i.transform[4],
            y: i.transform[5],
            width: i.width,
          }));
          matriz.push(...agruparItensEmLinhas(itens));
          return '';
        },
      });
    } catch (erro) {
      this.logger.warn(
        `PDF ilegível no vínculo em massa: ${erro instanceof Error ? erro.message : erro}`,
      );
      throw new BadRequestException(
        'Não consegui ler este PDF. Se ele for uma foto/escaneado, envie a planilha.',
      );
    }
    if (matriz.length === 0) {
      throw new BadRequestException(
        'O PDF não tem texto legível (parece escaneado). ' + MSG_CABECALHO,
      );
    }
    return matriz;
  }
}

export type { LinhaVinculo };
