import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  Role,
  type AppointmentStatus,
  type ServiceType,
} from '.prisma/client';
import { Roles, RequireRoute } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AppointmentsService } from './appointments.service';
import type {
  CriarAgendamento,
  EditarAgendamento,
  MudarStatus,
} from './appointments.types';

interface AuthenticatedRequest {
  tenantId: string;
  user?: { id: string };
}

interface RemarcarBody {
  start: string;
  end: string;
}

@ApiTags('Agenda e Ordens de Serviço')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@RequireRoute('agenda')
@Controller('appointments')
export class AppointmentsController {
  constructor(private service: AppointmentsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR, Role.VIEWER)
  @ApiOperation({ summary: 'Eventos do calendário no período' })
  @ApiQuery({ name: 'from', required: true, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: true, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'technicianIds', required: false, description: 'Separados por vírgula' })
  @ApiQuery({ name: 'status', required: false, description: 'Separados por vírgula' })
  @ApiQuery({ name: 'serviceType', required: false })
  @ApiQuery({ name: 'search', required: false })
  agenda(
    @Req() req: AuthenticatedRequest,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('technicianIds') technicianIds?: string,
    @Query('status') status?: string,
    @Query('serviceType') serviceType?: ServiceType,
    @Query('search') search?: string,
  ) {
    return this.service.agenda(req.tenantId, {
      from: inicioDoDia(from),
      to: fimDoDia(to),
      technicianIds: lista(technicianIds),
      status: lista(status) as AppointmentStatus[] | undefined,
      serviceType,
      search,
    });
  }

  @Get('pendencias')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR, Role.VIEWER)
  @ApiOperation({
    summary: 'Fila de serviços a agendar, espelhada do SGA (lista arrastável)',
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  pendencias(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.service.pendencias(
      req.tenantId,
      limit ? Number(limit) : undefined,
      search,
    );
  }

  @Get('lookup')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Preenche o formulário a partir da placa ou do chassi' })
  @ApiQuery({ name: 'termo', required: true })
  lookup(@Req() req: AuthenticatedRequest, @Query('termo') termo: string) {
    return this.service.preencherPorPlaca(req.tenantId, termo ?? '');
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR, Role.VIEWER)
  @ApiOperation({ summary: 'Ficha do agendamento' })
  porId(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.porId(req.tenantId, id);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Cria o agendamento e abre a ordem de serviço' })
  criar(@Req() req: AuthenticatedRequest, @Body() body: CriarAgendamento) {
    return this.service.criar(req.tenantId, body, req.user?.id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Edita o agendamento' })
  editar(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: EditarAgendamento,
  ) {
    return this.service.editar(req.tenantId, id, body);
  }

  @Patch(':id/remarcar')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Remarca arrastando o bloco no calendário' })
  remarcar(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: RemarcarBody,
  ) {
    return this.service.remarcar(
      req.tenantId,
      id,
      new Date(body.start),
      new Date(body.end),
    );
  }

  @Patch(':id/status')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Muda o status da OS' })
  mudarStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: MudarStatus,
  ) {
    return this.service.mudarStatus(req.tenantId, id, body);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Remove o agendamento (soft delete)' })
  remover(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.remover(req.tenantId, id);
  }
}

function lista(v?: string): string[] | undefined {
  if (!v) return undefined;
  const itens = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return itens.length ? itens : undefined;
}

function inicioDoDia(dia: string): Date {
  const [a, m, d] = (dia ?? '').split('-').map(Number);
  if (!a || !m || !d) return new Date(0);
  return new Date(a, m - 1, d, 0, 0, 0, 0);
}

function fimDoDia(dia: string): Date {
  const [a, m, d] = (dia ?? '').split('-').map(Number);
  if (!a || !m || !d) return new Date(8640000000000000);
  return new Date(a, m - 1, d, 23, 59, 59, 999);
}
