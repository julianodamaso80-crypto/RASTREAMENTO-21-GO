import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { Roles, RequireRoute } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ConsultantsService } from './consultants.service';

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
  @ApiOperation({ summary: 'Todos os consultores espelhados do Power CRM, com a ficha completa' })
  list(@Req() req: AuthenticatedRequest) {
    return this.service.listAll(req.tenantId);
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
}
