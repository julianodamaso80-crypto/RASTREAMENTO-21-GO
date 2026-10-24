import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PERFIS_QUE_VEEM_TAG } from '../clients/clients-tags';
import { HistoryRequestsService } from './history-requests.service';
import { TagHistoryRequestsService } from './tag-history-requests.service';
import { TagHistoryQueryDto, TagHistorySerialDto } from './dto/tag-history.dto';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; name?: string };
}

/**
 * Histórico de localização da TAG (consulta, PDF com link e lista de gerados).
 * A TAG é segredo interno: só os perfis que já enxergam TAG no painel passam.
 */
@ApiTags('Histórico da TAG')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(...PERFIS_QUE_VEEM_TAG)
@Controller('tag-history')
export class TagHistoryController {
  constructor(
    private tagHistory: TagHistoryRequestsService,
    private historyRequests: HistoryRequestsService,
  ) {}

  @Get('report')
  @ApiOperation({ summary: 'Histórico da TAG por período (básico, avançado, consolidado)' })
  report(@Query() q: TagHistoryQueryDto, @Req() req: AuthenticatedRequest) {
    return this.tagHistory.consultar(req.tenantId, q.serial, q.from, q.to, q.type);
  }

  @Post('requests')
  @ApiOperation({ summary: 'Gera o histórico da TAG em PDF (aba Solicitados)' })
  criar(@Body() body: TagHistoryQueryDto, @Req() req: AuthenticatedRequest) {
    return this.tagHistory.criar({
      tenantId: req.tenantId,
      serial: body.serial,
      from: body.from,
      to: body.to,
      type: body.type,
      solicitante: { userId: req.user?.id, nome: req.user?.name ?? null },
    });
  }

  @Get('requests')
  @ApiOperation({ summary: 'Históricos em PDF já gerados para a TAG' })
  listar(@Query() q: TagHistorySerialDto, @Req() req: AuthenticatedRequest) {
    return this.tagHistory.listar(req.tenantId, q.serial);
  }

  @Get('requests/:id/pdf')
  @ApiOperation({ summary: 'Baixar o PDF de um histórico de TAG gerado' })
  async baixar(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const { pdf, nome } = await this.historyRequests.pdfDoPainel(req.tenantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(pdf);
  }
}
