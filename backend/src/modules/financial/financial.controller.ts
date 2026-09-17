import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FinancialService } from './financial.service';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';

interface AuthenticatedRequest {
  tenantId: string;
  user?: { id?: string; name?: string; email?: string };
}

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('financial-entries')
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class FinancialController {
  constructor(private service: FinancialService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os lançamentos financeiros' })
  findAll(
    @Query('search') search: string | undefined,
    @Query('status') status: string | undefined,
    @Query('month') month: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.findAll(
      req.tenantId,
      search,
      status,
      month ? Number(month) : undefined,
      from,
      to,
    );
  }

  @Get('consultants')
  @ApiOperation({ summary: 'Busca consultor pelo nome para preencher nome e contato' })
  searchConsultants(
    @Query('search') search: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.searchConsultants(req.tenantId, search);
  }

  @Get('report.pdf')
  @ApiOperation({ summary: 'Relatório do período em PDF (mesmos filtros da tela)' })
  async relatorio(
    @Query('search') search: string | undefined,
    @Query('status') status: string | undefined,
    @Query('month') month: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('periodo') periodo: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const pdf = await this.service.relatorioPdf(
      req.tenantId,
      { search, status, month: month ? Number(month) : undefined, from, to, periodo },
      req.user?.name || req.user?.email || null,
    );
    const arquivo = `financeiro-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${arquivo}"`);
    pdf.pipe(res);
    pdf.end();
  }

  @Post(':id/receipt')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Anexa o comprovante de pagamento (imagem ou PDF)' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }), // 10 MB
  )
  anexarComprovante(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.anexarComprovante(id, req.tenantId, file, req.user?.id);
  }

  @Get(':id/receipt')
  @ApiOperation({ summary: 'Baixa o comprovante anexado' })
  async baixarComprovante(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const arquivo = await this.service.comprovante(id, req.tenantId);
    res.setHeader('Content-Type', arquivo.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${arquivo.fileName.replace(/"/g, '')}"`,
    );
    res.end(Buffer.from(arquivo.data));
  }

  @Delete(':id/receipt')
  @ApiOperation({ summary: 'Remove o comprovante anexado' })
  removerComprovante(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.removerComprovante(id, req.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Cria um lançamento financeiro' })
  create(@Body() dto: CreateFinancialEntryDto, @Req() req: AuthenticatedRequest) {
    return this.service.create(dto, req.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita um lançamento financeiro' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinancialEntryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.update(id, dto, req.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um lançamento (soft delete)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.remove(id, req.tenantId);
  }
}
