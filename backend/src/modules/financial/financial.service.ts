import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import { FINANCIAL_STATUSES } from './financial.constants';

@Injectable()
export class FinancialService {
  constructor(private prisma: PrismaService) {}

  findAll(
    tenantId: string,
    search?: string,
    status?: string,
    month?: number,
    from?: string,
    to?: string,
  ) {
    const where: any = { tenantId, deletedAt: null };
    const termo = search?.trim();
    if (termo) {
      where.OR = [
        { plate: { contains: termo, mode: 'insensitive' } },
        { consultantName: { contains: termo, mode: 'insensitive' } },
        { receiptId: { contains: termo, mode: 'insensitive' } },
      ];
    }
    if (status && (FINANCIAL_STATUSES as readonly string[]).includes(status)) {
      where.status = status;
    }
    if (month && month >= 1 && month <= 12) where.month = month;
    // Período do lançamento: `from` inclusivo, `to` exclusivo. O painel manda
    // os limites já no fuso de quem está olhando.
    const inicio = from ? new Date(from) : null;
    const fim = to ? new Date(to) : null;
    if (inicio && !isNaN(inicio.getTime())) where.createdAt = { gte: inicio };
    if (fim && !isNaN(fim.getTime())) where.createdAt = { ...where.createdAt, lt: fim };
    return this.prisma.financialEntry.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  /** Sugestões do campo consultor: base espelhada do Power CRM, ativos primeiro. */
  searchConsultants(tenantId: string, search?: string) {
    const termo = search?.trim();
    if (!termo) return [];
    return this.prisma.consultant.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { name: { contains: termo, mode: 'insensitive' } },
          { nickname: { contains: termo, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, mobile: true, phone: true, active: true },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      take: 15,
    });
  }

  create(dto: CreateFinancialEntryDto, tenantId: string) {
    return this.prisma.financialEntry.create({ data: { ...dto, tenantId } });
  }

  async update(id: string, dto: UpdateFinancialEntryDto, tenantId: string) {
    await this.ensureExists(id, tenantId);
    return this.prisma.financialEntry.update({ where: { id }, data: dto });
  }

  async remove(id: string, tenantId: string) {
    await this.ensureExists(id, tenantId);
    await this.prisma.financialEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id };
  }

  private async ensureExists(id: string, tenantId: string) {
    const found = await this.prisma.financialEntry.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Lançamento não encontrado');
  }
}
