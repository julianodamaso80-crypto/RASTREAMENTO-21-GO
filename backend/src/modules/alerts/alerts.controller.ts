import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { FilterAlertsDto } from './dto/filter-alerts.dto';

interface AuthenticatedRequest {
  tenantId: string;
}

@ApiTags('Alertas')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private alertsService: AlertsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista alertas (paginado, com filtros)' })
  async findAll(@Query() filters: FilterAlertsDto, @Req() req: AuthenticatedRequest) {
    return this.alertsService.findAll(req.tenantId, filters);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Contagem de alertas não lidos' })
  async unreadCount(@Req() req: AuthenticatedRequest) {
    return this.alertsService.getUnreadCount(req.tenantId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marcar alerta como lido' })
  async markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.alertsService.markAsRead(id, req.tenantId);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Marcar todos os alertas como lidos' })
  async markAllAsRead(@Req() req: AuthenticatedRequest) {
    return this.alertsService.markAllAsRead(req.tenantId);
  }
}
