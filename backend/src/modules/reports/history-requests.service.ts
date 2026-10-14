import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ReverseGeocodeService } from '../geocoding/reverse-geocode.service';
import { ReportsService } from './reports.service';
import type { TipoRelatorio } from './history-report';
import { gerarHistoricoPdf } from './history-report.pdf';

/** Quanto tempo o link sem login continua abrindo o PDF. */
export const VALIDADE_LINK_DIAS = 90;
/**
 * Teto de linhas por PDF. O pdfkit monta tudo na thread única do backend:
 * painel até ~330 páginas, app até ~100 (associado não precisa de mais).
 */
const MAX_LINHAS_PDF = { PAINEL: 10_000, APP: 3_000 } as const;

export interface Solicitante {
  origem: 'PAINEL' | 'APP';
  userId?: string;
  associateId?: string;
  nome?: string | null;
}

/** O que a lista "Solicitados" mostra — nunca o arquivo nem quem pediu por dentro. */
const RESUMO = {
  id: true,
  plate: true,
  from: true,
  to: true,
  type: true,
  source: true,
  requestedByName: true,
  shareToken: true,
  expiresAt: true,
  rowCount: true,
  pdfSize: true,
  createdAt: true,
} as const;

type Resumo = {
  id: string;
  plate: string;
  from: Date;
  to: Date;
  type: string;
  source: string;
  requestedByName: string | null;
  shareToken: string;
  expiresAt: Date;
  rowCount: number;
  pdfSize: number;
  createdAt: Date;
};

export function linkPublico(token: string): string {
  const base = (process.env.PUBLIC_API_URL || 'https://api.trackgo.site').replace(/\/$/, '');
  return `${base}/api/v1/public/historico/${token}`;
}

/** Sem associado/empresa no token, `where` com undefined listaria de todos. */
function exigirAssociado(tenantId: string | undefined, associateId: string | undefined) {
  if (!tenantId || !associateId) throw new UnauthorizedException('Associado não identificado');
}

export function numeroDoDocumento(id: string): string {
  return id.replace(/-/g, '').slice(0, 10).toUpperCase();
}

@Injectable()
export class HistoryRequestsService {
  private readonly logger = new Logger(HistoryRequestsService.name);
  /** Veículos com PDF sendo gerado agora: um por vez, clique repetido não empilha. */
  private readonly emAndamento = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private reports: ReportsService,
    private geocode: ReverseGeocodeService,
  ) {}

  private paraTela(r: Resumo, comQuemPediu: boolean) {
    return {
      id: r.id,
      plate: r.plate,
      from: r.from.toISOString(),
      to: r.to.toISOString(),
      type: r.type,
      source: r.source,
      requestedByName: comQuemPediu ? r.requestedByName : null,
      rowCount: r.rowCount,
      pdfSize: r.pdfSize,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      expired: r.expiresAt.getTime() < Date.now(),
      url: linkPublico(r.shareToken),
      number: numeroDoDocumento(r.id),
    };
  }

  /** Gera o PDF do período, grava e devolve o item da lista "Solicitados". */
  async criar(params: {
    tenantId: string;
    vehicleId: string;
    from: string;
    to: string;
    type: string;
    maxDias: number;
    solicitante: Solicitante;
  }) {
    if (params.solicitante.origem === 'APP') {
      exigirAssociado(params.tenantId, params.solicitante.associateId);
    } else if (!params.tenantId) {
      throw new UnauthorizedException('Empresa não identificada');
    }
    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id: params.vehicleId,
        tenantId: params.tenantId,
        deletedAt: null,
        // No app, só o veículo do próprio associado.
        ...(params.solicitante.origem === 'APP'
          ? { associateId: params.solicitante.associateId }
          : {}),
      },
      select: {
        id: true,
        plate: true,
        brand: true,
        model: true,
        traccarDeviceId: true,
        associate: { select: { name: true } },
      },
    });
    if (!vehicle) throw new NotFoundException('Veículo não encontrado');
    if (!vehicle.traccarDeviceId) {
      throw new BadRequestException('Este veículo ainda não tem rastreador vinculado.');
    }
    if (this.emAndamento.has(vehicle.id)) {
      throw new ConflictException('Já existe um PDF sendo gerado para este veículo. Aguarde.');
    }
    this.emAndamento.add(vehicle.id);
    try {
      return await this.gerar(params, { ...vehicle, traccarDeviceId: vehicle.traccarDeviceId });
    } finally {
      this.emAndamento.delete(vehicle.id);
    }
  }

  private async gerar(
    params: {
      tenantId: string;
      from: string;
      to: string;
      type: string;
      maxDias: number;
      solicitante: Solicitante;
    },
    vehicle: {
      id: string;
      plate: string;
      brand: string | null;
      model: string | null;
      traccarDeviceId: number;
      associate: { name: string } | null;
    },
  ) {

    const report = await this.reports.getHistoryReport(
      vehicle.traccarDeviceId,
      params.from,
      params.to,
      params.type,
      params.maxDias,
    );
    if (report.rows.length > MAX_LINHAS_PDF[params.solicitante.origem]) {
      throw new BadRequestException(
        'Registros demais para um PDF. Reduza o período ou use o Consolidado.',
      );
    }
    const pontos = [...report.rows, ...report.days];
    const enderecos = pontos.length
      ? await this.geocode.lookupLote(pontos.map((p) => ({ latitude: p.lat, longitude: p.lng })))
      : new Map<string, string>();
    const endereco = (lat: number, lng: number) => {
      const chave = this.geocode.chave({ latitude: lat, longitude: lng });
      return (chave && enderecos.get(chave)) || null;
    };

    const uuid = randomUUID();
    const geradoEm = new Date();
    const pdf = await gerarHistoricoPdf({
      numero: numeroDoDocumento(uuid),
      plate: vehicle.plate,
      veiculo: [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || null,
      associado: vehicle.associate?.name ?? null,
      from: params.from,
      to: params.to,
      type: params.type as TipoRelatorio,
      totals: report.totals,
      rows: report.rows.map((r) => ({ ...r, address: endereco(r.lat, r.lng) })),
      days: report.days.map((d) => ({ ...d, address: endereco(d.lat, d.lng) })),
      geradoEm,
    });

    const criado = await this.prisma.historyReportRequest.create({
      data: {
        id: uuid,
        tenantId: params.tenantId,
        vehicleId: vehicle.id,
        plate: vehicle.plate,
        from: new Date(params.from),
        to: new Date(params.to),
        type: params.type,
        source: params.solicitante.origem,
        requestedByUserId: params.solicitante.userId ?? null,
        requestedByAssociateId: params.solicitante.associateId ?? null,
        requestedByName:
          params.solicitante.nome ??
          (params.solicitante.origem === 'APP' ? (vehicle.associate?.name ?? null) : null),
        shareToken: randomBytes(32).toString('base64url'),
        expiresAt: new Date(geradoEm.getTime() + VALIDADE_LINK_DIAS * 24 * 3600_000),
        rowCount: params.type === 'consolidado' ? report.days.length : report.rows.length,
        pdf: new Uint8Array(pdf),
        pdfSize: pdf.length,
        createdAt: geradoEm,
      },
      select: RESUMO,
    });
    return this.paraTela(criado, params.solicitante.origem === 'PAINEL');
  }

  /**
   * Link vencido não abre mais; o arquivo só ocuparia disco (o droplet vive
   * no limite). Esvazia o PDF e mantém a linha como registro do pedido.
   */
  @Cron('0 30 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async esvaziarVencidos(): Promise<void> {
    const r = await this.prisma.historyReportRequest.updateMany({
      where: { expiresAt: { lt: new Date() }, pdfSize: { gt: 0 } },
      data: { pdf: new Uint8Array(0), pdfSize: 0 },
    });
    if (r.count) this.logger.log(`PDFs de histórico vencidos esvaziados: ${r.count}`);
  }

  /** Painel: tudo que foi gerado para o veículo, pelo painel e pelo app. */
  async listarDoVeiculo(tenantId: string, vehicleId: string) {
    const itens = await this.prisma.historyReportRequest.findMany({
      where: { tenantId, vehicleId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: RESUMO,
    });
    return itens.map((r) => this.paraTela(r, true));
  }

  /** App: só o que o próprio associado pediu (nada de nome de operador interno). */
  async listarDoAssociado(tenantId: string, associateId: string, vehicleId: string) {
    exigirAssociado(tenantId, associateId);
    const itens = await this.prisma.historyReportRequest.findMany({
      where: { tenantId, vehicleId, requestedByAssociateId: associateId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: RESUMO,
    });
    return itens.map((r) => this.paraTela(r, false));
  }

  async pdfDoPainel(tenantId: string, id: string) {
    const r = await this.prisma.historyReportRequest.findFirst({
      where: { id, tenantId },
      select: { pdf: true, plate: true, from: true, pdfSize: true },
    });
    if (!r) throw new NotFoundException('Histórico não encontrado');
    if (!r.pdfSize) throw new GoneException('Este histórico expirou. Gere um novo.');
    return { pdf: Buffer.from(r.pdf), nome: nomeDoArquivo(r.plate, r.from) };
  }

  async pdfDoAssociado(tenantId: string, associateId: string, id: string) {
    exigirAssociado(tenantId, associateId);
    const r = await this.prisma.historyReportRequest.findFirst({
      where: { id, tenantId, requestedByAssociateId: associateId },
      select: { pdf: true, plate: true, from: true, pdfSize: true },
    });
    if (!r) throw new NotFoundException('Histórico não encontrado');
    if (!r.pdfSize) throw new GoneException('Este histórico expirou. Gere um novo.');
    return { pdf: Buffer.from(r.pdf), nome: nomeDoArquivo(r.plate, r.from) };
  }

  /** Link público: só pelo código aleatório e dentro da validade. */
  async pdfPorToken(token: string) {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new NotFoundException('Link inválido');
    const r = await this.prisma.historyReportRequest.findFirst({
      where: { shareToken: token },
      select: { pdf: true, plate: true, from: true, expiresAt: true },
    });
    if (!r) throw new NotFoundException('Link inválido');
    if (r.expiresAt.getTime() < Date.now()) {
      throw new GoneException('Este link expirou. Peça um novo histórico.');
    }
    return { pdf: Buffer.from(r.pdf), nome: nomeDoArquivo(r.plate, r.from) };
  }
}

function nomeDoArquivo(plate: string, from: Date): string {
  const dia = from.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return `historico-${plate}-${dia}.pdf`;
}
