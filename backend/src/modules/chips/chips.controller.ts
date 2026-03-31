import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ChipsService } from './chips.service';
import { CreateChipDto } from './dto/create-chip.dto';
import { UpdateChipDto } from './dto/update-chip.dto';
import { FilterChipsDto } from './dto/filter-chips.dto';

interface AuthenticatedRequest {
  tenantId: string;
}

@ApiTags('Chips M2M')
@ApiBearerAuth()
@Controller('chips')
export class ChipsController {
  constructor(private chipsService: ChipsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista chips M2M (paginado, com filtros)' })
  async findAll(@Query() filters: FilterChipsDto, @Req() req: AuthenticatedRequest) {
    return this.chipsService.findAll(req.tenantId, filters);
  }

  @Get('operators')
  @ApiOperation({ summary: 'Lista operadoras com APNs padrão' })
  getOperators() {
    return this.chipsService.getOperatorsWithApns();
  }

  @Get('providers')
  @ApiOperation({ summary: 'Lista fornecedores M2M conhecidos' })
  getProviders() {
    return this.chipsService.getProviders();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes do chip' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.chipsService.findOne(id, req.tenantId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Cadastrar novo chip M2M' })
  async create(@Body() dto: CreateChipDto, @Req() req: AuthenticatedRequest) {
    return this.chipsService.create(dto, req.tenantId);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Atualizar chip' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChipDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chipsService.update(id, dto, req.tenantId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Remover chip (soft delete)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.chipsService.remove(id, req.tenantId);
  }
}
