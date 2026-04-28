import {
  Body,
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
import { ResolveAlertDto } from './dto/resolve-alert.dto';
import { CommentAlertDto } from './dto/comment-alert.dto';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; email?: string };
}

@ApiTags('Alertas')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private alertsService: AlertsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista alertas (paginado, com filtros)' })
  async findAll(
    @Query() filters: FilterAlertsDto,
    @Req() req: AuthenticatedRequest,
  ) {
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

  // ─── Workflow ───────────────────────────────────────────────────

  @Post(':id/assume')
  @ApiOperation({
    summary:
      'Assumir alerta — muda status para IN_PROGRESS e atribui ao usuário',
  })
  async assume(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.alertsService.assume(id, req.tenantId, {
      userId: req.user.id,
      email: req.user.email ?? null,
    });
  }

  @Post(':id/resolve')
  @ApiOperation({
    summary: 'Resolver alerta — exige observação explicando a tratativa',
  })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveAlertDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.alertsService.resolve(id, req.tenantId, dto.resolution, {
      userId: req.user.id,
      email: req.user.email ?? null,
    });
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: 'Reabrir alerta resolvido' })
  async reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.alertsService.reopen(id, req.tenantId, {
      userId: req.user.id,
      email: req.user.email ?? null,
    });
  }

  @Post(':id/comment')
  @ApiOperation({ summary: 'Adicionar comentário ao histórico do alerta' })
  async comment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentAlertDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.alertsService.comment(id, req.tenantId, dto.comment, {
      userId: req.user.id,
      email: req.user.email ?? null,
    });
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Histórico completo de tratativa do alerta' })
  async history(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.alertsService.getHistory(id, req.tenantId);
  }
}
