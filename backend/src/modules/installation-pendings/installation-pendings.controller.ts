import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Role } from '.prisma/client';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { InstallationPendingsService } from './installation-pendings.service';
import { InstallationPendingsExportService } from './installation-pendings-export.service';
import { RoutesService } from './routes.service';
import type { PendingType } from './installation-pendings.types';

interface AuthenticatedRequest {
  tenantId: string;
  user?: { id: string };
}

interface CreateRouteBody {
  technicianId: string;
  pendingIds: string[];
}

const DIAS_PADRAO = 60;

@ApiTags('Pendências de Instalação')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR, Role.VIEWER)
@Controller('installation-pendings')
export class InstallationPendingsController {
  constructor(
    private service: InstallationPendingsService,
    private exportService: InstallationPendingsExportService,
    private routes: RoutesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista pendências de instalação de rastreador e TAG' })
  @ApiQuery({ name: 'days', required: false, description: 'Janela sobre a data de contrato (padrão 60)' })
  @ApiQuery({ name: 'type', required: false, enum: ['TRACKER', 'TAG'] })
  @ApiQuery({ name: 'city', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'Placa, nome ou CPF' })
  list(
    @Req() req: AuthenticatedRequest,
    @Query('days') days?: string,
    @Query('type') type?: PendingType,
    @Query('city') city?: string,
    @Query('search') search?: string,
  ) {
    return this.service.list(req.tenantId, {
      days: parseDias(days),
      type: type || undefined,
      city: city || undefined,
      search: search || undefined,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Totais, patrimônio exposto e data do último sync' })
  @ApiQuery({ name: 'days', required: false })
  stats(@Req() req: AuthenticatedRequest, @Query('days') days?: string) {
    return this.service.stats(req.tenantId, parseDias(days));
  }

  @Get('cities')
  @ApiOperation({ summary: 'Cidades presentes na fila (para o filtro)' })
  cities(@Req() req: AuthenticatedRequest) {
    return this.service.cities(req.tenantId);
  }

  @Get('export')
  @ApiOperation({ summary: 'Exporta a fila filtrada em XLSX' })
  @ApiQuery({ name: 'days', required: false })
  @ApiQuery({ name: 'type', required: false, enum: ['TRACKER', 'TAG'] })
  async export(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query('days') days?: string,
    @Query('type') type?: PendingType,
    @Query('city') city?: string,
    @Query('search') search?: string,
  ) {
    const janela = parseDias(days);
    const linhas = await this.service.list(req.tenantId, {
      days: janela,
      type: type || undefined,
      city: city || undefined,
      search: search || undefined,
      limit: 100000,
    });

    const buffer = await this.exportService.toXlsx(linhas);
    const hoje = new Date().toISOString().slice(0, 10);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=pendentes-instalacao-${janela}dias-${hoje}.xlsx`,
    );
    res.send(buffer);
  }

  @Post('sync')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({
    summary:
      'Dispara a varredura do SGA em background e retorna na hora; acompanhe por sync/status',
  })
  sync(@Req() req: AuthenticatedRequest) {
    return this.service.startSync(req.tenantId);
  }

  @Get('sync/status')
  @ApiOperation({ summary: 'Situação da varredura em andamento e da última concluída' })
  syncStatus() {
    return this.service.getSyncStatus();
  }

  // --- Rota inteligente ---

  @Get('clusters')
  @ApiOperation({ summary: 'Bolsões de pendências próximas, pra montar rota' })
  @ApiQuery({ name: 'days', required: false })
  @ApiQuery({ name: 'type', required: false, enum: ['TRACKER', 'TAG'] })
  @ApiQuery({ name: 'minValue', required: false, description: 'Valor protegido mínimo' })
  @ApiQuery({ name: 'minDaysPending', required: false, description: 'Parado há pelo menos N dias' })
  @ApiQuery({ name: 'city', required: false })
  clusters(
    @Req() req: AuthenticatedRequest,
    @Query('days') days?: string,
    @Query('type') type?: PendingType,
    @Query('minValue') minValue?: string,
    @Query('minDaysPending') minDaysPending?: string,
    @Query('city') city?: string,
  ) {
    return this.routes.clusters(req.tenantId, {
      days: parseDias(days),
      type: type || undefined,
      minValue: parseNum(minValue),
      minDaysPending: parseNum(minDaysPending),
      city: city || undefined,
    });
  }

  @Get('routes')
  @ApiOperation({ summary: 'Rotas montadas e seu status' })
  listRoutes(@Req() req: AuthenticatedRequest) {
    return this.routes.listRoutes(req.tenantId);
  }

  @Post('routes')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Monta uma rota ordenada e envia pro técnico' })
  createRoute(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateRouteBody,
  ) {
    return this.routes.createRoute(
      req.tenantId,
      body.technicianId,
      body.pendingIds ?? [],
      req.user?.id,
    );
  }

  @Post('routes/:id/cancel')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Cancela uma rota' })
  cancelRoute(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.routes.cancelRoute(req.tenantId, id);
  }
}

/** Aceita 30/60/90; qualquer outra coisa cai no padrão de 60 dias. */
function parseDias(valor?: string): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 && n <= 3650 ? Math.floor(n) : DIAS_PADRAO;
}

/** Número positivo opcional; vazio/inválido vira undefined (sem filtro). */
function parseNum(valor?: string): number | undefined {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
