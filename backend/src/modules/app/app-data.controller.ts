import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { AppDataService } from './app-data.service';
import { AssociateJwtGuard } from './guards/associate-jwt.guard';
import { CurrentAssociate } from './decorators/current-associate.decorator';

@ApiTags('App - Dados do Associado')
@ApiBearerAuth()
@Public()
@UseGuards(AssociateJwtGuard)
@Controller('app')
export class AppDataController {
  constructor(private readonly service: AppDataService) {}

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
}
