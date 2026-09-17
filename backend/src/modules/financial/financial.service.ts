import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import { FINANCIAL_STATUSES } from './financial.constants';

/** Celular só com dígitos → (21) 99834-5046. Formato desconhecido volta como veio. */
function formatarContato(valor: string | null | undefined): string | null {
  const d = (valor ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return valor?.trim() || null;
}

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

  /**
   * Vínculo feito no Estoque ("Associar (SGA)") abre a linha do Financeiro com
   * o que o sistema já sabe: placa, consultor (nome do voluntário que o SGA
   * mandou na pendência) e o celular dele na base de consultores. O resto —
   * situação, mês, comprovante, quantidade — o financeiro preenche na mão, por
   * isso a linha nasce em SEM COMPROVANTE.
   *
   * Placa que já tem lançamento aberto não gera outro: reinstalar o rastreador
   * no mesmo carro não é venda nova.
   */
  async registrarVinculo(dados: {
    tenantId: string;
    plate: string;
    consultantName?: string | null;
  }) {
    const plate = dados.plate.trim().toUpperCase();
    if (!plate) return null;
    const jaTem = await this.prisma.financialEntry.findFirst({
      where: { tenantId: dados.tenantId, plate, deletedAt: null },
      select: { id: true },
    });
    if (jaTem) return null;

    const consultantName = dados.consultantName?.trim().toUpperCase() || null;
    let consultantContact: string | null = null;
    if (consultantName) {
      const consultor = await this.prisma.consultant.findFirst({
        where: {
          tenantId: dados.tenantId,
          deletedAt: null,
          name: { equals: consultantName, mode: 'insensitive' },
        },
        orderBy: { active: 'desc' },
        select: { mobile: true, phone: true },
      });
      consultantContact = formatarContato(consultor?.mobile || consultor?.phone);
    }

    return this.prisma.financialEntry.create({
      data: {
        tenantId: dados.tenantId,
        plate,
        status: 'NO_RECEIPT',
        consultantName,
        consultantContact,
      },
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
