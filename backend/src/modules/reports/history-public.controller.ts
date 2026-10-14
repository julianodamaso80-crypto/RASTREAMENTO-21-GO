import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators';
import { HistoryRequestsService } from './history-requests.service';

/**
 * Link do histórico em PDF que o cliente recebe (multa, sinistro). Abre sem
 * login: quem tem o código de 32 bytes aleatórios tem o documento, até expirar.
 */
@ApiTags('Público')
@Public()
@Controller('public/historico')
export class HistoryPublicController {
  constructor(private historyRequests: HistoryRequestsService) {}

  @Get(':token')
  @ApiOperation({ summary: 'PDF do histórico pelo link compartilhado' })
  async abrir(@Param('token') token: string, @Res() res: Response) {
    const { pdf, nome } = await this.historyRequests.pdfPorToken(token);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(pdf);
  }
}
