import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { FilterStockDto } from './dto/filter-stock.dto';

type ParsedRow = {
  imei: string;
  iccid: string | null;
  line: string | null;
  operator: string | null;
  status: string | null;
  server: string | null;
  registeredAt: Date | null;
  activatedAt: Date | null;
};

export type ImportResult = {
  imported: number; // linhas criadas
  updated: number; // linhas atualizadas (IMEI já existia)
  skipped: number; // linhas ignoradas (sem IMEI)
  total: number; // linhas de dados lidas
};

// Normaliza cabeçalho: remove acentos, espaços extras e caixa alta, pra casar variações.
function normalizeHeader(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Mapa de cabeçalho da planilha -> campo do model. Aceita variações comuns.
const HEADER_MAP: Record<string, keyof ParsedRow> = {
  ICCID: 'iccid',
  LINHA: 'line',
  TELEFONE: 'line',
  NUMERO: 'line',
  MSISDN: 'line',
  IMEI: 'imei',
  OPERADORA: 'operator',
  STATUS: 'status',
  DATA: 'registeredAt',
  'DATA DE ATIVACAO': 'activatedAt',
  'DATA ATIVACAO': 'activatedAt',
  ATIVACAO: 'activatedAt',
  SERVER: 'server',
  SERVIDOR: 'server',
};

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, filters: FilterStockDto) {
    const { page, perPage, search, status, operator } = filters;
    const where: Record<string, unknown> = { tenantId, deletedAt: null };

    if (status) where.status = { equals: status, mode: 'insensitive' };
    if (operator) where.operator = { equals: operator, mode: 'insensitive' };
    if (search) {
      where.OR = [
        { imei: { contains: search, mode: 'insensitive' } },
        { iccid: { contains: search, mode: 'insensitive' } },
        { line: { contains: search, mode: 'insensitive' } },
        { operator: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.stockItem.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.stockItem.count({ where }),
    ]);

    return { data, meta: { total, page, perPage } };
  }

  async stats(tenantId: string) {
    const where = { tenantId, deletedAt: null };
    const [total, byStatusRaw] = await Promise.all([
      this.prisma.stockItem.count({ where }),
      this.prisma.stockItem.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
    ]);
    const byStatus = byStatusRaw.map(
      (r: { status: string | null; _count: { _all: number } }) => ({
        status: r.status ?? 'SEM STATUS',
        count: r._count._all,
      }),
    );
    return { total, byStatus };
  }

  async remove(id: string, tenantId: string) {
    const item = await this.prisma.stockItem.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Item de estoque não encontrado');
    await this.prisma.stockItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { id };
  }

  async importFromBuffer(
    buffer: Buffer,
    tenantId: string,
  ): Promise<ImportResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException(
        'Arquivo inválido. Envie uma planilha .xlsx válida.',
      );
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      throw new BadRequestException('Planilha vazia ou sem dados.');
    }

    // Mapeia índice da coluna -> campo, lendo a primeira linha como cabeçalho.
    const headerRow = worksheet.getRow(1);
    const colToField = new Map<number, keyof ParsedRow>();
    for (let c = 1; c <= worksheet.columnCount; c++) {
      const header = this.cellText(headerRow.getCell(c));
      if (!header) continue;
      const field = HEADER_MAP[normalizeHeader(header)];
      if (field) colToField.set(c, field);
    }

    if (!Array.from(colToField.values()).includes('imei')) {
      throw new BadRequestException(
        'A planilha precisa ter uma coluna "IMEI".',
      );
    }

    const rows: ParsedRow[] = [];
    let skipped = 0;
    for (let r = 2; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const parsed: ParsedRow = {
        imei: '',
        iccid: null,
        line: null,
        operator: null,
        status: null,
        server: null,
        registeredAt: null,
        activatedAt: null,
      };
      for (const [col, field] of colToField) {
        const cell = row.getCell(col);
        if (field === 'registeredAt' || field === 'activatedAt') {
          parsed[field] = this.cellDate(cell);
        } else {
          const value = this.cellText(cell) || null;
          parsed[field] = value as never;
        }
      }
      if (!parsed.imei) {
        skipped++;
        continue;
      }
      rows.push(parsed);
    }

    if (rows.length === 0) {
      throw new BadRequestException(
        'Nenhuma linha com IMEI encontrada na planilha.',
      );
    }

    // Classifica criados vs atualizados comparando com o que já existe no tenant.
    const imeis = rows.map((row) => row.imei);
    const existing = await this.prisma.stockItem.findMany({
      where: { tenantId, imei: { in: imeis } },
      select: { imei: true },
    });
    const existingSet = new Set(existing.map((e) => e.imei));

    let imported = 0;
    let updated = 0;

    // Upsert por (tenantId, imei) em lotes pra não estourar o pool de conexões.
    const batchSize = 25;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await Promise.all(
        batch.map((row) =>
          this.prisma.stockItem.upsert({
            where: { tenantId_imei: { tenantId, imei: row.imei } },
            create: {
              tenantId,
              imei: row.imei,
              iccid: row.iccid,
              line: row.line,
              operator: row.operator,
              status: row.status,
              server: row.server,
              registeredAt: row.registeredAt,
              activatedAt: row.activatedAt,
            },
            update: {
              iccid: row.iccid,
              line: row.line,
              operator: row.operator,
              status: row.status,
              server: row.server,
              registeredAt: row.registeredAt,
              activatedAt: row.activatedAt,
              deletedAt: null, // reimportar restaura item removido
            },
          }),
        ),
      );
      for (const row of batch) {
        if (existingSet.has(row.imei)) updated++;
        else imported++;
      }
    }

    this.logger.log(
      `Import estoque tenant=${tenantId}: ${imported} novos, ${updated} atualizados, ${skipped} ignorados`,
    );

    return { imported, updated, skipped, total: rows.length };
  }

  // --- helpers de leitura de célula (exceljs retorna tipos variados) ---

  private cellText(cell: ExcelJS.Cell): string {
    const value = cell?.value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim();
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const v = value as unknown as Record<string, unknown>;
      if ('text' in v && v.text != null) return String(v.text).trim();
      if ('result' in v && v.result != null) return String(v.result).trim();
      if ('richText' in v && Array.isArray(v.richText)) {
        return (v.richText as Array<{ text: string }>)
          .map((t) => t.text)
          .join('')
          .trim();
      }
    }
    return String(value).trim();
  }

  private cellDate(cell: ExcelJS.Cell): Date | null {
    const value = cell?.value;
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object' && value && 'result' in value) {
      const r = (value as { result: unknown }).result;
      if (r instanceof Date) return r;
    }
    const text = this.cellText(cell);
    if (!text) return null;
    const parsed = new Date(text);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
}
