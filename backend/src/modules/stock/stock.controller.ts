import {
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
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StockService } from './stock.service';
import { FilterStockDto } from './dto/filter-stock.dto';

interface AuthenticatedRequest {
  tenantId: string;
}

@ApiTags('Estoque')
@ApiBearerAuth()
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
