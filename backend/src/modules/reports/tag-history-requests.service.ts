import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReverseGeocodeService } from '../geocoding/reverse-geocode.service';
import {
  buildTagHistoryReport,
  validarPeriodoTag,
  type AvistamentoTag,
  type RelatorioDaTag,
  type TipoRelatorioTag,
} from '../ble-tags/tag-history-report';
import { gerarHistoricoTagPdf } from '../ble-tags/tag-history-report.pdf';
import { VALIDADE_LINK_DIAS, linkPublico, numeroDoDocumento } from './history-requests.service';

/** O que o histórico da TAG guarda: a rede Find My devolve 7 dias, nós acumulamos. */
const MAX_DIAS_TAG = 90;
/** Teto de avistamentos lidos por consulta (a TAG é vista de 15 em 15 min, no máximo). */
const MAX_AVISTAMENTOS = 20_000;
/** O pdfkit monta tudo na thread única do backend: mesmo teto do painel dos rastreadores. */
const MAX_LINHAS_PDF = 10_000;

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

export interface SolicitanteTag {
  userId?: string;
  nome?: string | null;
}

@Injectable()
export class TagHistoryRequestsService {
  /** TAGs com PDF sendo gerado agora: uma por vez, clique repetido não empilha. */
  private readonly emAndamento = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private geocode: ReverseGeocodeService,
  ) {}

  private paraTela(r: Resumo) {
    return {
      id: r.id,
      plate: r.plate,
      from: r.from.toISOString(),
      to: r.to.toISOString(),
      type: r.type,
      source: r.source,
      requestedByName: r.requestedByName,
      rowCount: r.rowCount,
      pdfSize: r.pdfSize,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      expired: r.expiresAt.getTime() < Date.now(),
      url: linkPublico(r.shareToken),
      number: numeroDoDocumento(r.id),
    };
  }

  /** Vínculo da TAG com a placa, sempre dentro da empresa. */
  private async vinculoDaTag(tenantId: string, serial: string) {
    const vinculo = await this.prisma.tagLink.findFirst({
      where: { tenantId, serialNumber: serial, deletedAt: null },
      select: { plate: true, associateName: true },
    });
    if (!vinculo) throw new NotFoundException('Esta TAG não está vinculada a um veículo.');
    const veiculo = await this.prisma.vehicle.findFirst({
      where: { tenantId, plate: vinculo.plate, deletedAt: null },
      select: { brand: true, model: true },
    });
    return {
      plate: vinculo.plate,
      associado: vinculo.associateName ?? null,
      veiculo: [veiculo?.brand, veiculo?.model].filter(Boolean).join(' ') || null,
    };
  }

  private async avistamentos(
    tenantId: string,
    serial: string,
    from: string,
    to: string,
  ): Promise<AvistamentoTag[]> {
    const linhas = await this.prisma.tagPosition.findMany({
      where: {
        tenantId,
        serialNumber: serial,
        seenAt: { gte: new Date(from), lte: new Date(to) },
      },
      orderBy: { seenAt: 'asc' },
      take: MAX_AVISTAMENTOS,
      select: {
        seenAt: true,
        receivedAt: true,
        latitude: true,
        longitude: true,
        accuracyM: true,
        source: true,
      },
    });
    return linhas;
  }

  private async comEnderecos<T extends { lat: number; lng: number }>(pontos: T[]) {
    const enderecos = pontos.length
      ? await this.geocode.lookupLote(pontos.map((p) => ({ latitude: p.lat, longitude: p.lng })))
      : new Map<string, string>();
    return pontos.map((p) => {
      const chave = this.geocode.chave({ latitude: p.lat, longitude: p.lng });
      return { ...p, address: (chave && enderecos.get(chave)) || null };
    });
  }

  private async montar(
    tenantId: string,
    serial: string,
    from: string,
    to: string,
    type: string,
  ): Promise<{ report: RelatorioDaTag; vinculo: Awaited<ReturnType<TagHistoryRequestsService['vinculoDaTag']>> }> {
    validarPeriodoTag(from, to, type, MAX_DIAS_TAG);
    const vinculo = await this.vinculoDaTag(tenantId, serial);
    const brutos = await this.avistamentos(tenantId, serial, from, to);
    return { report: buildTagHistoryReport(brutos, type as TipoRelatorioTag), vinculo };
  }

  /** Consulta na tela (antes de gerar o PDF). */
  async consultar(tenantId: string, serial: string, from: string, to: string, type: string) {
    const { report, vinculo } = await this.montar(tenantId, serial, from, to, type);
    return {
      plate: vinculo.plate,
      serial,
      from,
      to,
      type,
      totals: report.totals,
      rows: await this.comEnderecos(report.rows),
      days: await this.comEnderecos(report.days),
    };
  }

  /** Gera o PDF do período, grava e devolve o item da lista "Solicitados". */
  async criar(params: {
    tenantId: string;
    serial: string;
    from: string;
    to: string;
    type: string;
    solicitante: SolicitanteTag;
  }) {
    const chave = `${params.tenantId}:${params.serial}`;
    if (this.emAndamento.has(chave)) {
      throw new ConflictException('Já existe um PDF sendo gerado para esta TAG. Aguarde.');
    }
    this.emAndamento.add(chave);
    try {
      const { report, vinculo } = await this.montar(
        params.tenantId,
        params.serial,
        params.from,
        params.to,
        params.type,
      );
      const linhas = params.type === 'consolidado' ? report.days.length : report.rows.length;
      if (linhas > MAX_LINHAS_PDF) {
        throw new BadRequestException(
          'Registros demais para um PDF. Reduza o período ou use o Consolidado.',
        );
      }
      const rows = await this.comEnderecos(report.rows);
      const days = await this.comEnderecos(report.days);

      const uuid = randomUUID();
      const geradoEm = new Date();
      const pdf = await gerarHistoricoTagPdf({
        numero: numeroDoDocumento(uuid),
        plate: vinculo.plate,
        serial: params.serial,
        veiculo: vinculo.veiculo,
        associado: vinculo.associado,
        from: params.from,
        to: params.to,
        type: params.type as TipoRelatorioTag,
        totals: report.totals,
        rows,
        days,
        geradoEm,
      });

      const criado = await this.prisma.historyReportRequest.create({
        data: {
          id: uuid,
          tenantId: params.tenantId,
          vehicleId: null,
          tagSerial: params.serial,
          plate: vinculo.plate,
          from: new Date(params.from),
          to: new Date(params.to),
          type: params.type,
          source: 'PAINEL',
          requestedByUserId: params.solicitante.userId ?? null,
          requestedByName: params.solicitante.nome ?? null,
          shareToken: randomBytes(32).toString('base64url'),
          expiresAt: new Date(geradoEm.getTime() + VALIDADE_LINK_DIAS * 24 * 3600_000),
          rowCount: linhas,
          pdf: new Uint8Array(pdf),
          pdfSize: pdf.length,
          createdAt: geradoEm,
        },
        select: RESUMO,
      });
      return this.paraTela(criado);
    } finally {
      this.emAndamento.delete(chave);
    }
  }

  /** Aba "Solicitados" da TAG: o que já foi gerado para este número, na empresa. */
  async listar(tenantId: string, serial: string) {
    const itens = await this.prisma.historyReportRequest.findMany({
      where: { tenantId, tagSerial: serial },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: RESUMO,
    });
    return itens.map((r) => this.paraTela(r));
  }
}
