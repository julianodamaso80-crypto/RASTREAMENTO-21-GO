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
import { PERFIS_QUE_VEEM_TAG, podeVerTag } from './clients-tags';
import { AssociateAuthService } from '../app/associate-auth.service';
import {
  SetAppAccessDto,
  SetBlockerAccessDto,
  SetFinancialStatusDto,
  SetInstallLocationDto,
  SetTechnicianDto,
  TransferOwnershipDto,
} from './dto/asset-actions.dto';
import { OwnershipTransferService } from './ownership-transfer.service';

interface AuthenticatedRequest {
  tenantId: string;
  user: { role: Role };
}

@ApiTags('Clientes Ativos')
@ApiBearerAuth()
@RequireRoute('clientes')
@Controller('clients')
export class ClientsController {
  constructor(
    private clientsService: ClientsService,
    private associateAuth: AssociateAuthService,
    private ownershipTransfer: OwnershipTransferService,
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
      // TAG é segredo interno: só o time vê. CLIENT nem chega aqui (não tem a
      // rota 'clientes'), mas o gate por papel é a barreira que não depende disso.
      verTags: podeVerTag(req.user?.role),
    });
  }

  /**
   * As TAGs de cliente para o Mapa. Segue a permissão da TELA do mapa (não a de
   * Clientes Ativos): quem vê o mapa vê as TAGs nele. E só o time interno —
   * a TAG é segredo, o associado nunca sabe que ela existe.
   */
  @Get('tags-map')
  @RequireRoute('mapa')
  @UseGuards(RolesGuard)
  @Roles(...PERFIS_QUE_VEEM_TAG)
  @ApiOperation({ summary: 'TAGs de cliente sem rastreador, com a última posição (Mapa)' })
  tagsNoMapa(@Req() req: AuthenticatedRequest) {
    return this.clientsService.tagsNoMapa(req.tenantId);
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
  @Patch('assets/:vehicleId/blocker-access')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Libera ou retira o bloqueador do app para um ativo' })
  setBlockerAccess(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: SetBlockerAccessDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.clientsService.setBlockerAccess(
      req.tenantId,
      vehicleId,
      dto.allowed,
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

  @Patch('assets/:vehicleId/install-location')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Corrige onde o rastreador foi escondido no veículo' })
  setInstallLocation(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: SetInstallLocationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.clientsService.setInstallLocation(
      req.tenantId,
      vehicleId,
      dto.installLocation,
    );
  }

  /**
   * Troca de titularidade: mesma consulta do "Associar (SGA)", mas o rastreador
   * fica onde está — só o dono do veículo muda. INATIVO no SGA só passa com
   * `allowInactive` e usuário administrador, como no vínculo do estoque.
   */
  @Post('assets/:vehicleId/transfer-ownership')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({
    summary:
      'Troca de titularidade: passa o veículo para o associado que o SGA devolve para a placa',
  })
  transferOwnership(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: TransferOwnershipDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const liberadorAdmin =
      req.user.role === Role.SUPER_ADMIN || req.user.role === Role.ADMIN;
    return this.ownershipTransfer.transfer(
      req.tenantId,
      vehicleId,
      dto,
      liberadorAdmin,
    );
  }

  /** Mesma troca para quem só tem TAG: o dono mora no vínculo, não num Vehicle. */
  @Post('tag-links/:linkId/transfer-ownership')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({
    summary:
      'Troca de titularidade de TAG sem rastreador: passa o vínculo para o associado que o SGA devolve para a placa',
  })
  transferTagOwnership(
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() dto: TransferOwnershipDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const liberadorAdmin =
      req.user.role === Role.SUPER_ADMIN || req.user.role === Role.ADMIN;
    return this.ownershipTransfer.transferTag(
      req.tenantId,
      linkId,
      dto,
      liberadorAdmin,
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
