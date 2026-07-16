import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { FilterStockDto } from './dto/filter-stock.dto';
import { AssociateStockDto } from './dto/associate-stock.dto';
import { HINOVA_CLIENT, type IHinovaClient } from '../hinova/hinova.interface';
import { TraccarService } from '../traccar/traccar.service';

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

  constructor(
    private prisma: PrismaService,
    @Inject(HINOVA_CLIENT) private hinova: IHinovaClient,
    private traccar: TraccarService,
  ) {}

  async findAll(tenantId: string, filters: FilterStockDto) {
    const { page, perPage, search, status, operator } = filters;
    // associatedAt: null → só rastreadores disponíveis (associados saíram do estoque).
    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      associatedAt: null,
    };

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

  /**
   * Associar cliente e ativo: vincula um rastreador do estoque a uma placa do
   * SGA, criando cliente (Associate) + veículo (Vehicle) + rastreador (Device),
   * e tirando o item do estoque disponível. O IMEI é a identidade única.
   *
   * Regras (decididas com o usuário):
   * - Placa não encontrada no SGA → bloqueia (422).
   * - Placa INATIVA no SGA → bloqueia (422).
   * - Técnico e local de instalação obrigatórios (validados no DTO).
   */
  async associate(id: string, tenantId: string, dto: AssociateStockDto) {
    const item = await this.prisma.stockItem.findFirst({
      where: { id, tenantId, deletedAt: null, associatedAt: null },
    });
    if (!item) {
      throw new NotFoundException(
        'Item de estoque não encontrado ou já associado.',
      );
    }

    // Fonte da verdade: o servidor rebusca no SGA (não confia no que veio da tela).
    const lookup = await this.hinova.lookupByPlate(dto.placa);
    if (!lookup.encontrado) {
      throw new UnprocessableEntityException(
        lookup.motivo || 'Placa não encontrada no SGA.',
      );
    }
    if (!lookup.ativo) {
      throw new UnprocessableEntityException(
        `Placa ${lookup.veiculo.placa ?? dto.placa} está ${
          lookup.situacao.descricao ?? 'INATIVA'
        } no SGA — vínculo bloqueado.`,
      );
    }
    if (!lookup.cliente.cpf) {
      throw new UnprocessableEntityException(
        'SGA não retornou o CPF do cliente para esta placa.',
      );
    }

    const placa = (lookup.veiculo.placa ?? dto.placa)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const technicianName = dto.technicianName.trim();
    const installLocation = dto.installLocation.trim();

    const result = await this.prisma.$transaction(async (tx) => {
      // 1) Cliente — dedupe por (tenant, cpf).
      let associate = await tx.associate.findFirst({
        where: { tenantId, cpf: lookup.cliente.cpf!, deletedAt: null },
      });
      if (associate) {
        associate = await tx.associate.update({
          where: { id: associate.id },
          data: {
            name: lookup.cliente.nome ?? associate.name,
            hinovaCode: lookup.veiculo.codigoVeiculo ?? associate.hinovaCode,
          },
        });
      } else {
        associate = await tx.associate.create({
          data: {
            tenantId,
            name: lookup.cliente.nome ?? 'Associado (SGA)',
            cpf: lookup.cliente.cpf!,
            hinovaCode: lookup.veiculo.codigoVeiculo,
          },
        });
      }

      // 2) Veículo — dedupe por (placa, tenant) OU uniqueId (IMEI).
      let vehicle = await tx.vehicle.findFirst({
        where: {
          OR: [
            { plate: placa, tenantId, deletedAt: null },
            { uniqueId: item.imei, deletedAt: null },
          ],
        },
      });
      if (vehicle) {
        vehicle = await tx.vehicle.update({
          where: { id: vehicle.id },
          data: {
            plate: placa,
            chassi: lookup.veiculo.chassi ?? vehicle.chassi,
            model: lookup.veiculo.modelo ?? vehicle.model,
            status: 'ACTIVE',
            associateId: associate.id,
            hinovaCode: lookup.veiculo.codigoVeiculo ?? vehicle.hinovaCode,
            lastSync: new Date(),
          },
        });
      } else {
        vehicle = await tx.vehicle.create({
          data: {
            plate: placa,
            uniqueId: item.imei,
            chassi: lookup.veiculo.chassi,
            model: lookup.veiculo.modelo,
            status: 'ACTIVE',
            tenantId,
            associateId: associate.id,
            hinovaCode: lookup.veiculo.codigoVeiculo,
            lastSync: new Date(),
          },
        });
      }

      // 3) Rastreador — um Device por IMEI e por veículo.
      const existingDevice = await tx.device.findUnique({
        where: { imei: item.imei },
      });
      const device = existingDevice
        ? await tx.device.update({
            where: { id: existingDevice.id },
            data: {
              vehicleId: vehicle.id,
              status: 'INSTALLED',
              installedAt: new Date(),
              installedBy: technicianName,
              installLocation,
            },
          })
        : await tx.device.create({
            data: {
              imei: item.imei,
              model: 'OTHER',
              status: 'INSTALLED',
              vehicleId: vehicle.id,
              tenantId,
              installedAt: new Date(),
              installedBy: technicianName,
              installLocation,
            },
          });

      // 4) Item sai do estoque disponível.
      await tx.stockItem.update({
        where: { id: item.id },
        data: { associatedAt: new Date(), deviceId: device.id },
      });

      return { associate, vehicle, device };
    });

    // 5) Traccar (best-effort — não derruba o vínculo se estiver indisponível).
    try {
      let traccarDevice = await this.traccar.getDeviceByUniqueId(item.imei);
      if (!traccarDevice) {
        traccarDevice = await this.traccar.createDevice(placa, item.imei);
      }
      if (traccarDevice?.id) {
        await this.prisma.$transaction([
          this.prisma.vehicle.update({
            where: { id: result.vehicle.id },
            data: { traccarDeviceId: traccarDevice.id },
          }),
          this.prisma.device.update({
            where: { id: result.device.id },
            data: { traccarDeviceId: traccarDevice.id },
          }),
        ]);
      }
    } catch (error) {
      this.logger.warn(
        `Associação ${item.imei}: Traccar indisponível (${
          error instanceof Error ? error.message : error
        }). Device vinculado sem traccarDeviceId.`,
      );
    }

    this.logger.log(
      `Estoque associado: IMEI ${item.imei} → placa ${placa} (cliente ${result.associate.id})`,
    );

    return {
      ok: true,
      associateId: result.associate.id,
      vehicleId: result.vehicle.id,
      deviceId: result.device.id,
      placa,
    };
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
