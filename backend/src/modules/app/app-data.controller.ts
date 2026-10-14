import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { AppDataService } from './app-data.service';
import { AssociateJwtGuard } from './guards/associate-jwt.guard';
import { CurrentAssociate } from './decorators/current-associate.decorator';
import { NotificationPrefsDto } from './dto/notification-prefs.dto';
import { HistoryRequestsService } from '../reports/history-requests.service';

@ApiTags('App - Dados do Associado')
@ApiBearerAuth()
@Public()
@UseGuards(AssociateJwtGuard)
@Controller('app')
export class AppDataController {
  constructor(
    private readonly service: AppDataService,
    private readonly historyRequests: HistoryRequestsService,
  ) {}

  @Get('vehicles')
  @ApiOperation({
    summary: 'Veículos do associado + última posição + status de conexão',
  })
  async getVehicles(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
  ) {
    return this.service.getVehicles(associateId, tenantId);
  }

  @Post('vehicles/:id/block')
  @HttpCode(200)
  @ApiOperation({ summary: 'Associado bloqueia o próprio veículo (se liberado)' })
  async block(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Param('id') vehicleId: string,
  ) {
    return this.service.setBlocked(associateId, tenantId, vehicleId, true);
  }

  @Post('vehicles/:id/unblock')
  @HttpCode(200)
  @ApiOperation({ summary: 'Associado desbloqueia o próprio veículo (se liberado)' })
  async unblock(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Param('id') vehicleId: string,
  ) {
    return this.service.setBlocked(associateId, tenantId, vehicleId, false);
  }

  @Get('vehicles/:id/history')
  @ApiOperation({ summary: 'Histórico de posições de um veículo do associado' })
  @ApiQuery({ name: 'from', required: true, description: 'Início (ISO 8601)' })
  @ApiQuery({ name: 'to', required: true, description: 'Fim (ISO 8601)' })
  async getHistory(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Param('id') vehicleId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.getHistory(associateId, tenantId, vehicleId, from, to);
  }

  @Get('vehicles/:id/trips')
  @ApiOperation({
    summary: 'Trajetos do veículo no período (aba Trajetos do app)',
  })
  @ApiQuery({ name: 'from', required: true, description: 'Início (ISO 8601)' })
  @ApiQuery({ name: 'to', required: true, description: 'Fim (ISO 8601)' })
  async getTrips(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Param('id') vehicleId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.getTrips(associateId, tenantId, vehicleId, from, to);
  }

  @Get('vehicles/:id/journey')
  @ApiOperation({
    summary: 'Viagens do dia com trajeto (Histórico do app e da web)',
  })
  @ApiQuery({ name: 'date', required: true, description: 'Dia AAAA-MM-DD (Brasília)' })
  async getJourney(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Param('id') vehicleId: string,
    @Query('date') date: string,
    @Query('enderecos') enderecos?: string,
  ) {
    return this.service.getJourney(associateId, tenantId, vehicleId, date, enderecos === '1');
  }

  @Get('vehicles/:id/history-report')
  @ApiOperation({ summary: 'Histórico por período: básico, avançado ou consolidado' })
  @ApiQuery({ name: 'from', required: true, description: 'Início (ISO 8601)' })
  @ApiQuery({ name: 'to', required: true, description: 'Fim (ISO 8601)' })
  @ApiQuery({ name: 'type', required: true, description: 'basico | avancado | consolidado' })
  async getHistoryReport(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Param('id') vehicleId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('type') type: string,
  ) {
    return this.service.getHistoryReport(associateId, tenantId, vehicleId, from, to, type);
  }

  @Post('vehicles/:id/history-requests')
  @ApiOperation({ summary: 'Gera o histórico do período em PDF para o associado' })
  async createHistoryRequest(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) vehicleId: string,
    @Body() body: { from: string; to: string; type: string },
  ) {
    return this.historyRequests.criar({
      tenantId,
      vehicleId,
      from: String(body?.from ?? ''),
      to: String(body?.to ?? ''),
      type: String(body?.type ?? ''),
      maxDias: 31,
      solicitante: { origem: 'APP', associateId },
    });
  }

  @Get('vehicles/:id/history-requests')
  @ApiOperation({ summary: 'Históricos em PDF que o associado já pediu para o veículo' })
  async listHistoryRequests(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) vehicleId: string,
  ) {
    return this.historyRequests.listarDoAssociado(tenantId, associateId, vehicleId);
  }

  @Get('history-requests/:id/pdf')
  @ApiOperation({ summary: 'Baixar o PDF de um histórico do associado' })
  async downloadHistoryRequest(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { pdf, nome } = await this.historyRequests.pdfDoAssociado(tenantId, associateId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(pdf);
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Alertas dos veículos do associado' })
  @ApiQuery({ name: 'limit', required: false, description: 'Máx 100 (default 50)' })
  async getAlerts(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getAlerts(
      associateId,
      tenantId,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get('notificacoes')
  @ApiOperation({ summary: 'Quais avisos por push o associado escolheu receber' })
  async getNotificacoes(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
  ) {
    return this.service.getNotificationPrefs(associateId, tenantId);
  }

  @Patch('notificacoes')
  @ApiOperation({ summary: 'Liga/desliga os avisos por push do associado' })
  async setNotificacoes(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Body() body: NotificationPrefsDto,
  ) {
    return this.service.setNotificationPrefs(associateId, tenantId, body);
  }
}
