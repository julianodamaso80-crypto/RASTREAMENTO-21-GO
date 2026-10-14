import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RequireRoute } from '../../common/decorators';
import { ReportsService } from './reports.service';
import { ReverseGeocodeService } from '../geocoding/reverse-geocode.service';
import { HistoryRequestsService } from './history-requests.service';
import {
  ReportQueryDto,
  ExportQueryDto,
  JourneyQueryDto,
  HistoryReportQueryDto,
} from './dto/report-query.dto';

interface AuthenticatedRequest {
  tenantId: string;
  user?: { id?: string; name?: string };
}

@ApiTags('Relatórios')
@ApiBearerAuth()
@RequireRoute('relatorios')
@Controller('reports')
export class ReportsController {
  constructor(
    private reportsService: ReportsService,
    private prisma: PrismaService,
    private geocode: ReverseGeocodeService,
    private historyRequests: HistoryRequestsService,
  ) {}

  private async validateDevice(deviceId: number, tenantId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { traccarDeviceId: deviceId, tenantId, deletedAt: null },
    });
    if (!vehicle) throw new NotFoundException('Dispositivo não encontrado');
    return vehicle;
  }

  @Get('positions')
  @ApiOperation({ summary: 'Histórico de posições' })
  async getPositions(
    @Query() query: ReportQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.validateDevice(query.deviceId, req.tenantId);
    return this.reportsService.getPositions(
      query.deviceId,
      query.from,
      query.to,
    );
  }

  @Get('trips')
  @ApiOperation({ summary: 'Relatório de viagens' })
  async getTrips(
    @Query() query: ReportQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.validateDevice(query.deviceId, req.tenantId);
    return this.reportsService.getTrips(query.deviceId, query.from, query.to);
  }

  @Get('journey')
  @ApiOperation({ summary: 'Viagens do dia com trajeto (histórico por dia)' })
  async getJourney(
    @Query() query: JourneyQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.validateDevice(query.deviceId, req.tenantId);
    const jornada = await this.reportsService.getJourney(query.deviceId, query.date);
    if (query.enderecos !== '1') return jornada;
    const trips: typeof jornada.trips = [];
    for (const t of jornada.trips) {
      trips.push({ ...t, path: await this.geocode.enderecarPontos(t.path) });
    }
    return { ...jornada, trips };
  }

  @Get('history-report')
  @ApiOperation({ summary: 'Histórico por período (básico, avançado, consolidado)' })
  async getHistoryReport(
    @Query() query: HistoryReportQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const vehicle = await this.validateDevice(query.deviceId, req.tenantId);
    const report = await this.reportsService.getHistoryReport(
      query.deviceId,
      query.from,
      query.to,
      query.type,
    );
    const pontos = [...report.rows, ...report.days];
    const enderecos = pontos.length
      ? await this.geocode.lookupLote(
          pontos.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        )
      : new Map<string, string>();
    const endereco = (lat: number, lng: number) => {
      const chave = this.geocode.chave({ latitude: lat, longitude: lng });
      return (chave && enderecos.get(chave)) || null;
    };
    return {
      plate: vehicle.plate,
      from: query.from,
      to: query.to,
      type: query.type,
      totals: report.totals,
      rows: report.rows.map((r) => ({ ...r, address: endereco(r.lat, r.lng) })),
      days: report.days.map((d) => ({ ...d, address: endereco(d.lat, d.lng) })),
    };
  }

  @Post('history-requests')
  @ApiOperation({ summary: 'Gera o histórico do período em PDF (aba Solicitados)' })
  async createHistoryRequest(
    @Body() body: HistoryReportQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const vehicle = await this.validateDevice(body.deviceId, req.tenantId);
    return this.historyRequests.criar({
      tenantId: req.tenantId,
      vehicleId: vehicle.id,
      from: body.from,
      to: body.to,
      type: body.type,
      maxDias: 90,
      solicitante: { origem: 'PAINEL', userId: req.user?.id, nome: req.user?.name ?? null },
    });
  }

  @Get('history-requests')
  @ApiOperation({ summary: 'Históricos em PDF já gerados para o veículo' })
  async listHistoryRequests(
    @Query('deviceId', ParseIntPipe) deviceId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    const vehicle = await this.validateDevice(deviceId, req.tenantId);
    return this.historyRequests.listarDoVeiculo(req.tenantId, vehicle.id);
  }

  @Get('history-requests/:id/pdf')
  @ApiOperation({ summary: 'Baixar o PDF de um histórico gerado' })
  async downloadHistoryRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const { pdf, nome } = await this.historyRequests.pdfDoPainel(req.tenantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(pdf);
  }

  @Get('stops')
  @ApiOperation({ summary: 'Relatório de paradas' })
  async getStops(
    @Query() query: ReportQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.validateDevice(query.deviceId, req.tenantId);
    return this.reportsService.getStops(query.deviceId, query.from, query.to);
  }

  @Get('export')
  @ApiOperation({ summary: 'Exportar relatório (Excel/CSV)' })
  async exportReport(
    @Query() query: ExportQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    await this.validateDevice(query.deviceId, req.tenantId);

    if (query.format === 'xlsx') {
      const buffer = await this.reportsService.exportExcel(
        query.type,
        query.deviceId,
        query.from,
        query.to,
      );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=relatorio-${query.type}.xlsx`,
      );
      res.send(buffer);
    } else {
      let csvData: string;
      if (query.type === 'positions') {
        const positions = await this.reportsService.getPositions(
          query.deviceId,
          query.from,
          query.to,
        );
        csvData = this.reportsService.exportCsv(
          positions.map((p) => ({
            time: p.deviceTime,
            lat: p.latitude,
            lng: p.longitude,
            speed: Math.round(p.speed * 1.852),
            course: Math.round(p.course),
            address: p.address || '',
          })),
          ['time', 'lat', 'lng', 'speed', 'course', 'address'],
        );
      } else if (query.type === 'trips') {
        const trips = await this.reportsService.getTrips(
          query.deviceId,
          query.from,
          query.to,
        );
        csvData = this.reportsService.exportCsv(
          trips as unknown as Record<string, unknown>[],
          [
            'startTime',
            'endTime',
            'duration',
            'distance',
            'avgSpeed',
            'maxSpeed',
          ],
        );
      } else {
        const stops = await this.reportsService.getStops(
          query.deviceId,
          query.from,
          query.to,
        );
        csvData = this.reportsService.exportCsv(
          stops as unknown as Record<string, unknown>[],
          ['address', 'startTime', 'endTime', 'duration'],
        );
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=relatorio-${query.type}.csv`,
      );
      res.send(csvData);
    }
  }
}
