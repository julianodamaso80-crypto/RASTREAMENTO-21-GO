import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { LocationSharesService } from './location-shares.service';

/**
 * Página "compartilhar localização": quem tem o código de 32 bytes aleatórios
 * vê o veículo ao vivo, sem login, até o prazo escolhido ou o cancelamento.
 */
@ApiTags('Público')
@Public()
@Controller('public/localizacao')
export class LocationSharePublicController {
  constructor(private shares: LocationSharesService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @ApiOperation({ summary: 'Posição atual do veículo pelo link compartilhado' })
  abrir(@Param('token') token: string) {
    return this.shares.publico(token);
  }
}
