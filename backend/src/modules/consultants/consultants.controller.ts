import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { Roles, RequireRoute } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ConsultantsService, type FiltroStatus } from './consultants.service';

interface AuthenticatedRequest {
  tenantId: string;
}

/** Só o time interno: associado (CLIENT) e técnico nunca chegam aqui. */
@ApiTags('Consultores')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR, Role.VIEWER)
@RequireRoute('consultores')
@Controller('consultants')
export class ConsultantsController {
  constructor(private service: ConsultantsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista consultores espelhados do Power CRM' })
  @ApiQuery({ name: 'search', required: false, description: 'Nome, e-mail, CPF ou telefone' })
  @ApiQuery({ name: 'status', required: false, enum: ['ativo', 'bloqueado'] })
  @ApiQuery({ name: 'office', required: false, description: 'Cargo no Power (4 = Consultor)' })
  @ApiQuery({ name: 'page', required: false })
  list(
    @Req() req: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('office') office?: string,
    @Query('page') page?: string,
  ) {
    const pagina = Number(page);
    const cargo = Number(office);
    return this.service.list(req.tenantId, {
      search: search?.slice(0, 80),
      status: status === 'ativo' || status === 'bloqueado' ? (status as FiltroStatus) : undefined,
      office: Number.isInteger(cargo) && cargo > 0 ? cargo : undefined,
      page: Number.isInteger(pagina) && pagina >= 0 ? Math.min(pagina, 1000) : 0,
    });
  }

  @Get('sync/status')
  @ApiOperation({ summary: 'Andamento da cópia do Power' })
  syncStatus() {
    return this.service.syncStatus();
  }

  @Post('sync')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Atualiza a lista agora, a partir do Power (roda em background)' })
  sync(@Req() req: AuthenticatedRequest) {
    return this.service.iniciarSincronizacao(req.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ficha completa do consultor' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(req.tenantId, id);
  }
}
