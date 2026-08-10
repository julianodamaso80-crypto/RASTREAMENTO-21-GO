import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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

  @Get()
  @ApiOperation({ summary: 'Lista clientes ativos (associados com veículo/rastreador)' })
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
