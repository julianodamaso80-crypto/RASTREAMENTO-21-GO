import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { RequireRoute, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientsService } from './clients.service';
import { AssociateAuthService } from '../app/associate-auth.service';
import {
  SetAppAccessDto,
  SetFinancialStatusDto,
  SetTechnicianDto,
} from './dto/asset-actions.dto';

interface AuthenticatedRequest {
  tenantId: string;
}

@ApiTags('Clientes Ativos')
@ApiBearerAuth()
@RequireRoute('clientes')
@Controller('clients')
export class ClientsController {
  constructor(
    private clientsService: ClientsService,
    private associateAuth: AssociateAuthService,
  ) {}

  @Get('assets')
  @ApiOperation({
    summary: 'Lista paginada de ativos (um item por veículo com cliente)',
  })
  findAssets(
    @Req() req: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.clientsService.findAssets(req.tenantId, {
      search,
      page: page ? Number(page) : undefined,
      perPage: perPage ? Number(perPage) : undefined,
    });
  }

  @Get('assets/summary')
  @ApiOperation({ summary: 'Composição da frota e ritmo de instalação' })
  assetsSummary(
    @Req() req: AuthenticatedRequest,
    @Query('weekOffset') weekOffset?: string,
  ) {
    return this.clientsService.assetsSummary(
      req.tenantId,
      weekOffset ? Number(weekOffset) : 0,
    );
  }

  @Patch('assets/:vehicleId/app-access')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Bloqueia ou libera o acesso do cliente a um ativo' })
  setAppAccess(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: SetAppAccessDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.clientsService.setAppAccess(
      req.tenantId,
      vehicleId,
      dto.blocked,
    );
  }

  @Patch('assets/:vehicleId/financial-status')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Override manual da situação financeira do ativo' })
  setFinancialStatus(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: SetFinancialStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.clientsService.setFinancialStatus(
      req.tenantId,
      vehicleId,
      dto.status,
    );
  }

  @Patch('assets/:vehicleId/technician')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Corrige o técnico que instalou o rastreador' })
  setTechnician(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: SetTechnicianDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.clientsService.setTechnician(
      req.tenantId,
      vehicleId,
      dto.technicianId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Lista clientes ativos agrupados por associado' })
  findActive(
    @Req() req: AuthenticatedRequest,
    @Query('search') search?: string,
  ) {
    return this.clientsService.findActive(req.tenantId, search);
  }

  /**
   * Redefine a senha do app do cliente e devolve uma senha temporária ditável.
   *
   * É o caminho de atendimento: funciona mesmo sem WhatsApp configurado, sem
   * telefone cadastrado e sem e-mail. A senha aparece uma única vez — no banco
   * fica só o hash — e o app obriga o cliente a criar a definitiva no acesso.
   */
  @Post(':id/reset-app-password')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({
    summary: 'Gera senha temporária do app para o cliente (atendimento)',
  })
  resetAppPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.associateAuth.resetPasswordByOperator(id, req.tenantId);
  }
}
