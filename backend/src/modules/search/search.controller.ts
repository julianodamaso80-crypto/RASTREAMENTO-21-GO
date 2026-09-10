import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';

interface AuthenticatedRequest {
  tenantId: string;
}

@ApiTags('Busca')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private service: SearchService) {}

  /**
   * Busca única do painel. Sem `RequireRoute`: é transversal, e o que ela
   * devolve já respeita o tenant. Fica fora do alcance do CLIENT — associado
   * nunca enxerga cadastro de terceiro.
   */
  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR, Role.VIEWER)
  @ApiOperation({
    summary:
      'Acha associado, veículo, pendência, estoque, chip ou TAG por placa, chassi, CPF/CNPJ, nome, chip ou IMEI',
  })
  buscar(
    @Req() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('porGrupo') porGrupo?: string,
  ) {
    return this.service.buscar(
      req.tenantId,
      q,
      porGrupo ? Number(porGrupo) : undefined,
    );
  }
}
