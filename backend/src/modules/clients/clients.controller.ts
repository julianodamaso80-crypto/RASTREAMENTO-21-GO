import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientsService } from './clients.service';

interface AuthenticatedRequest {
  tenantId: string;
}

@ApiTags('Clientes Ativos')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(private clientsService: ClientsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista clientes ativos (associados com veículo/rastreador)' })
  findActive(
    @Req() req: AuthenticatedRequest,
    @Query('search') search?: string,
  ) {
    return this.clientsService.findActive(req.tenantId, search);
  }
}
