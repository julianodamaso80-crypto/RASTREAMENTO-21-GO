import { Controller, Get, Query, Req, Res, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';
import { ReportQueryDto, ExportQueryDto } from './dto/report-query.dto';

interface AuthenticatedRequest {
  tenantId: string;
}

@ApiTags('Relatórios')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private reportsService: ReportsService,
    private prisma: PrismaService,
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
  async getPositions(@Query() query: ReportQueryDto, @Req() req: AuthenticatedRequest) {
    await this.validateDevice(query.deviceId, req.tenantId);
    return this.reportsService.getPositions(query.deviceId, query.from, query.to);
  }

  @Get('trips')
  @ApiOperation({ summary: 'Relatório de viagens' })
  async getTrips(@Query() query: ReportQueryDto, @Req() req: AuthenticatedRequest) {
    await this.validateDevice(query.deviceId, req.tenantId);
    return this.reportsService.getTrips(query.deviceId, query.from, query.to);
  }

  @Get('stops')
  @ApiOperation({ summary: 'Relatório de paradas' })
  async getStops(@Query() query: ReportQueryDto, @Req() req: AuthenticatedRequest) {
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
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=relatorio-${query.type}.xlsx`);
      res.send(buffer);
    } else {
      let csvData: string;
      if (query.type === 'positions') {
        const positions = await this.reportsService.getPositions(query.deviceId, query.from, query.to);
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
        const trips = await this.reportsService.getTrips(query.deviceId, query.from, query.to);
        csvData = this.reportsService.exportCsv(
          trips as unknown as Record<string, unknown>[],
          ['startTime', 'endTime', 'duration', 'distance', 'avgSpeed', 'maxSpeed'],
        );
      } else {
        const stops = await this.reportsService.getStops(query.deviceId, query.from, query.to);
        csvData = this.reportsService.exportCsv(
          stops as unknown as Record<string, unknown>[],
          ['address', 'startTime', 'endTime', 'duration'],
        );
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=relatorio-${query.type}.csv`);
      res.send(csvData);
    }
  }
}
