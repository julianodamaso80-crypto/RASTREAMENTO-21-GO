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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FinancialService } from './financial.service';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';

interface AuthenticatedRequest {
  tenantId: string;
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
