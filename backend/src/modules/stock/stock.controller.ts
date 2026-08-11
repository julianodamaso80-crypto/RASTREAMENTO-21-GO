import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { Roles, RequireRoute } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StockService } from './stock.service';
import { FilterStockDto } from './dto/filter-stock.dto';
import { AssociateStockDto } from './dto/associate-stock.dto';
import { AssignStockDto } from './dto/assign-stock.dto';
import { ValidateStockDto } from './dto/validate-stock.dto';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; name?: string; email?: string };
}

@ApiTags('Estoque')
@ApiBearerAuth()
@RequireRoute('estoque')
@Controller('stock')
export class StockController {
  constructor(private stockService: StockService) {}

  @Get()
  @ApiOperation({ summary: 'Lista o estoque de rastreadores (paginado)' })
  findAll(@Query() filters: FilterStockDto, @Req() req: AuthenticatedRequest) {
    return this.stockService.findAll(req.tenantId, filters);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Totais do estoque por status' })
  stats(@Req() req: AuthenticatedRequest) {
    return this.stockService.stats(req.tenantId);
  }

  @Get('connectivity')
  @ApiOperation({
    summary:
      'Conectividade do estoque no servidor GPS (cards e pontinho por linha)',
  })
  connectivity(@Req() req: AuthenticatedRequest) {
    return this.stockService.connectivity(req.tenantId);
  }

  @Get('map')
  @ApiOperation({
    summary:
      'Estoque no mapa: última posição conhecida e telemetria de cada rastreador',
  })
  map(@Req() req: AuthenticatedRequest) {
    return this.stockService.map(req.tenantId);
  }

  @Get(':id/signal')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({
    summary:
      'Conferência de instalação ao vivo: GPS, satélites, voltagem e ignição',
  })
  signal(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('lat') lat: string | undefined,
    @Query('lng') lng: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const refLat = lat === undefined ? undefined : Number(lat);
    const refLng = lng === undefined ? undefined : Number(lng);
    return this.stockService.signal(
      id,
      req.tenantId,
      Number.isFinite(refLat as number) ? refLat : undefined,
      Number.isFinite(refLng as number) ? refLng : undefined,
    );
  }

  @Post(':id/validate')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({
    summary: 'Carimba a conferência de instalação (aprovada ou reprovada)',
  })
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidateStockDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stockService.validate(
      id,
      req.tenantId,
      dto,
      req.user.id,
      req.user.name || req.user.email || 'Operador',
    );
  }

  @Post('import')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Importa planilha .xlsx de rastreadores' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
    }),
  )
  import(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stockService.importFromBuffer(file.buffer, req.tenantId);
  }

  @Post(':id/associate')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({
    summary:
      'Associar cliente e ativo: vincula o rastreador a uma placa do SGA',
  })
  associate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssociateStockDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stockService.associate(id, req.tenantId, dto);
  }

  @Post('assign')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({
    summary: 'Reserva equipamentos pro login do técnico (lote)',
  })
  assign(@Body() dto: AssignStockDto, @Req() req: AuthenticatedRequest) {
    return this.stockService.assign(req.tenantId, dto, req.user.id);
  }

  @Post('unassign')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Cancela a reserva e devolve ao estoque livre' })
  unassign(@Body() dto: AssignStockDto, @Req() req: AuthenticatedRequest) {
    return this.stockService.unassign(req.tenantId, dto.stockItemIds);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Remove um item do estoque (soft delete)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stockService.remove(id, req.tenantId);
  }
}
