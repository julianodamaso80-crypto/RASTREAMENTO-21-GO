import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import { FINANCIAL_STATUSES, FINANCIAL_STATUS_LABEL, MESES } from './financial.constants';
import { gerarRelatorioPdf } from './financial-report.pdf';

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
    return this.prisma.financialEntry.findMany({
      where: this.filtro(tenantId, search, status, month, from, to),
      include: {
        receipt: {
          select: { fileName: true, mimeType: true, size: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private filtro(
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
    return where;
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

  // --- Comprovante de pagamento ---

  /** Tipos que o financeiro anexa: foto do comprovante ou PDF do banco. */
  private static readonly TIPOS_ACEITOS = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf',
  ];

  async anexarComprovante(
    id: string,
    tenantId: string,
    arquivo: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    uploadedById?: string,
  ) {
    await this.ensureExists(id, tenantId);
    if (!FinancialService.TIPOS_ACEITOS.includes(arquivo.mimetype)) {
      throw new UnprocessableEntityException(
        'Anexe uma imagem (JPG, PNG, WEBP, HEIC) ou um PDF.',
      );
    }
    const dados = {
      fileName: arquivo.originalname.slice(0, 200),
      mimeType: arquivo.mimetype,
      size: arquivo.size,
      // Prisma tipa Bytes como Uint8Array; Buffer já é um, mas o tipo não casa.
      data: new Uint8Array(arquivo.buffer),
      uploadedById: uploadedById ?? null,
    };
    // Trocar o comprovante substitui o anterior — um lançamento, um arquivo.
    await this.prisma.financialReceipt.upsert({
      where: { entryId: id },
      create: { entryId: id, ...dados },
      update: dados,
    });
    return this.findOne(id, tenantId);
  }

  /** Arquivo em si, para download. */
  async comprovante(id: string, tenantId: string) {
    await this.ensureExists(id, tenantId);
    const arquivo = await this.prisma.financialReceipt.findUnique({
      where: { entryId: id },
    });
    if (!arquivo) throw new NotFoundException('Este lançamento não tem comprovante');
    return arquivo;
  }

  async removerComprovante(id: string, tenantId: string) {
    await this.ensureExists(id, tenantId);
    await this.prisma.financialReceipt.deleteMany({ where: { entryId: id } });
    return this.findOne(id, tenantId);
  }

  findOne(id: string, tenantId: string) {
    return this.prisma.financialEntry.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        receipt: {
          select: { fileName: true, mimeType: true, size: true, createdAt: true },
        },
      },
    });
  }

  /** Linhas do relatório, na ordem em que saem no PDF (mais antigo primeiro). */
  async paraRelatorio(
    tenantId: string,
    search?: string,
    status?: string,
    month?: number,
    from?: string,
    to?: string,
  ) {
    return this.prisma.financialEntry.findMany({
      where: this.filtro(tenantId, search, status, month, from, to),
      include: { receipt: { select: { fileName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Relatório do período em PDF. Recebe os mesmos filtros da tela, para o papel
   * sair igual ao que está na frente de quem clicou.
   */
  async relatorioPdf(
    tenantId: string,
    filtros: {
      search?: string;
      status?: string;
      month?: number;
      from?: string;
      to?: string;
      periodo?: string;
    },
    geradoPor?: string | null,
  ) {
    const [linhas, empresa] = await Promise.all([
      this.paraRelatorio(
        tenantId,
        filtros.search,
        filtros.status,
        filtros.month,
        filtros.from,
        filtros.to,
      ),
      this.prisma.tenant.findFirst({ where: { id: tenantId }, select: { name: true } }),
    ]);

    const descritos: string[] = [];
    if (filtros.search?.trim()) descritos.push(`busca "${filtros.search.trim()}"`);
    if (filtros.status && FINANCIAL_STATUS_LABEL[filtros.status]) {
      descritos.push(FINANCIAL_STATUS_LABEL[filtros.status]);
    }
    if (filtros.month && filtros.month >= 1 && filtros.month <= 12) {
      descritos.push(`mês ${MESES[filtros.month - 1]}`);
    }

    return gerarRelatorioPdf({
      linhas: linhas as any,
      periodo: filtros.periodo?.trim() || FinancialService.descreverPeriodo(filtros.from, filtros.to),
      filtros: descritos,
      empresa: empresa?.name ?? null,
      geradoPor: geradoPor ?? null,
    });
  }

  /** "01/09/2026 a 17/09/2026" — o `to` que chega é exclusivo. */
  private static descreverPeriodo(from?: string, to?: string): string {
    const dia = (valor?: string, ajuste = 0) => {
      if (!valor) return null;
      const d = new Date(valor);
      if (isNaN(d.getTime())) return null;
      d.setDate(d.getDate() + ajuste);
      return d.toLocaleDateString('pt-BR');
    };
    const inicio = dia(from);
    const fim = dia(to, -1);
    if (inicio && fim) return inicio === fim ? inicio : `${inicio} a ${fim}`;
    if (inicio) return `A partir de ${inicio}`;
    if (fim) return `Até ${fim}`;
    return 'Todo o período';
  }

  private async ensureExists(id: string, tenantId: string) {
    const found = await this.prisma.financialEntry.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Lançamento não encontrado');
  }
}
