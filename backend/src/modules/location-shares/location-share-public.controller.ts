import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { LocationSharesService } from './location-shares.service';
import { MapService } from '../map/map.service';

/**
 * Página "compartilhar localização": quem tem o código de 32 bytes aleatórios
 * vê o veículo ao vivo, sem login, até o prazo escolhido ou o cancelamento.
 */
@ApiTags('Público')
@Public()
@Controller('public/localizacao')
export class LocationSharePublicController {
  constructor(
    private shares: LocationSharesService,
    private map: MapService,
  ) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @ApiOperation({ summary: 'Posição atual do veículo pelo link compartilhado' })
  abrir(@Param('token') token: string) {
    return this.shares.publico(token);
  }

  /** Satélite do Google para quem abriu o link — só enquanto o link vale. */
  @Get(':token/mapa')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Sessão do satélite do Google para o link compartilhado' })
  async mapa(@Param('token') token: string) {
    await this.shares.validar(token);
    return this.map.tilesOuFallback('satellite');
  }

  @Get(':token/mapa/atribuicao')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Atribuição do Google do viewport (link compartilhado)' })
  async atribuicao(@Param('token') token: string, @Query() q: Record<string, string>) {
    await this.shares.validar(token);
    return this.map.attributionDaQuery(q);
  }
}
