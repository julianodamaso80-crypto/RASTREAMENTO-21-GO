import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MapService, type MapBasemapType } from './map.service';

@ApiTags('Mapa')
@ApiBearerAuth()
@Controller('map')
export class MapController {
  constructor(private mapService: MapService) {}

  @Get('tiles')
  @ApiOperation({ summary: 'Source de tiles do Google para o MapLibre' })
  async getTiles(@Query('type') type?: string) {
    const basemap: MapBasemapType = type === 'roadmap' ? 'roadmap' : 'satellite';

    if (!this.mapService.isEnabled) {
      // Não é erro: sinaliza ao front pra usar o Esri (fallback grátis).
      return { provider: 'esri' as const, enabled: false };
    }

    return this.mapService.getTileSource(basemap);
  }

  @Get('attribution')
  @ApiOperation({ summary: 'Atribuição obrigatória do viewport (política Google)' })
  async getAttribution(
    @Query('zoom') zoom: string,
    @Query('north') north: string,
    @Query('south') south: string,
    @Query('east') east: string,
    @Query('west') west: string,
  ) {
    return this.mapService.getViewportAttribution({
      zoom: Number(zoom),
      north: Number(north),
      south: Number(south),
      east: Number(east),
      west: Number(west),
    });
  }
}
