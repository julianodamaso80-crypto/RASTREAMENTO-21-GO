import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireRoute } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ReverseGeocodeService } from './reverse-geocode.service';

/**
 * Endereço de uma coordenada, para as telas que mostram um ponto só.
 *
 * O painel do veículo no mapa chamava o Nominatim direto do navegador, com
 * cache próprio de 50 m: o ícone andava e o texto ficava na rua anterior, e o
 * formato do endereço divergia do que o estoque mostrava para a mesma posição.
 * Com o endereço vindo daqui existe uma fonte só — mesmo cache, mesma fila de
 * 1 req/s exigida pelo OpenStreetMap, mesmo formato.
 */
@ApiTags('Geocoding')
@ApiBearerAuth()
@RequireRoute('mapa', 'estoque')
@Controller('geocode')
export class GeocodingController {
  constructor(private readonly geocode: ReverseGeocodeService) {}

  @Get('reverse')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Endereço da coordenada informada' })
  async reverse(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ): Promise<{ address: string | null }> {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { address: null };
    }
    return { address: await this.geocode.lookupNow({ latitude, longitude }) };
  }
}
