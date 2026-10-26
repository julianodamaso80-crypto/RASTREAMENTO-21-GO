import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireRoute } from '../../common/decorators';
import { LocationSharesService } from './location-shares.service';

interface AuthenticatedRequest {
  tenantId: string;
  user?: { id?: string; name?: string };
}

@ApiTags('Compartilhar localização')
@ApiBearerAuth()
@RequireRoute('mapa')
@Controller('location-shares')
export class LocationSharesController {
  constructor(private shares: LocationSharesService) {}

  private quem(req: AuthenticatedRequest) {
    return { origem: 'PAINEL' as const, userId: req.user?.id, nome: req.user?.name ?? null };
  }

  @Post()
  @ApiOperation({ summary: 'Gera link sem login com a localização do veículo por X horas' })
  criar(@Body() body: { vehicleId: string; hours: number }, @Req() req: AuthenticatedRequest) {
    return this.shares.criar(req.tenantId, String(body?.vehicleId ?? ''), Number(body?.hours), this.quem(req));
  }

  @Get()
  @ApiOperation({ summary: 'Links de localização já gerados para o veículo' })
  listar(@Query('vehicleId', ParseUUIDPipe) vehicleId: string, @Req() req: AuthenticatedRequest) {
    return this.shares.listar(req.tenantId, vehicleId, this.quem(req));
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancela o link antes do prazo' })
  cancelar(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.shares.cancelar(req.tenantId, id, this.quem(req));
  }
}
