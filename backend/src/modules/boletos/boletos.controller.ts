import { Body, Controller, Get, NotFoundException, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { AssociateJwtGuard } from '../app/guards/associate-jwt.guard';
import { CurrentAssociate } from '../app/decorators/current-associate.decorator';
import { BoletosService } from './boletos.service';
import { PushService } from './push.service';

@ApiTags('App - Boletos do Associado')
@ApiBearerAuth()
@Public()
@UseGuards(AssociateJwtGuard)
@Controller('app/boletos')
export class BoletosController {
  constructor(
    private readonly service: BoletosService,
    private readonly push: PushService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Boletos em aberto de todos os veículos do associado' })
  async listar(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
  ) {
    return this.service.listarDoAssociado(associateId, tenantId);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'PDF guardado do boleto' })
  async pdf(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Param('id') id: string,
    // @Res() sem passthrough: escapa do TransformInterceptor, que embrulharia
    // o binário em { data } e entregaria um PDF quebrado ao app.
    @Res() res: Response,
  ) {
    const pdf = await this.service.pdfDoBoleto(id, associateId, tenantId);
    if (!pdf) throw new NotFoundException('Boleto não encontrado.');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="boleto.pdf"');
    res.send(pdf);
  }

  @Post('dispositivo')
  @ApiOperation({ summary: 'Registra o aparelho do associado para receber push' })
  async registrarDispositivo(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Body() body: { expoToken: string; platform: string },
  ) {
    await this.push.registrarAparelho(associateId, tenantId, body.expoToken, body.platform);
    return { ok: true };
  }
}
