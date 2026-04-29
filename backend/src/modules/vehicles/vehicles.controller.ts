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
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { FilterVehiclesDto } from './dto/filter-vehicles.dto';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; tenantId: string; role: string };
}

const isClient = (role: string): boolean => role === Role.CLIENT;

@ApiTags('Veículos')
@ApiBearerAuth()
@Controller('vehicles')
export class VehiclesController {
  constructor(private vehiclesService: VehiclesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista veículos (paginado, com filtros)' })
  async findAll(
    @Query() filters: FilterVehiclesDto,
    @Req() req: AuthenticatedRequest,
  ) {
    // CLIENT só vê os próprios — usa rota /mine para clareza, mas aqui também
    // forçamos filtro pra evitar leak se um CLIENT chegar nessa rota.
    if (isClient(req.user.role)) {
      return this.vehiclesService.findOwnedByUser(
        req.user.id,
        req.tenantId,
        filters,
      );
    }
    return this.vehiclesService.findAll(req.tenantId, filters);
  }

  @Get('mine')
  @ApiOperation({
    summary: 'Lista veículos do usuário autenticado (CLIENT)',
    description:
      'Retorna veículos vinculados via UserVehicleAccess. Útil pro app/painel do cliente final.',
  })
  async findMine(
    @Query() filters: FilterVehiclesDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vehiclesService.findOwnedByUser(
      req.user.id,
      req.tenantId,
      filters,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes de um veículo' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (isClient(req.user.role)) {
      return this.vehiclesService.findOneOwnedByUser(
        id,
        req.user.id,
        req.tenantId,
      );
    }
    return this.vehiclesService.findOne(id, req.tenantId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Criar veículo + device no Traccar' })
  async create(
    @Body() dto: CreateVehicleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vehiclesService.create(dto, req.tenantId);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Atualizar veículo' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vehiclesService.update(id, dto, req.tenantId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Remover veículo (soft delete)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vehiclesService.remove(id, req.tenantId);
  }

  @Post(':id/block')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Bloquear veículo (envia comando ao rastreador)' })
  async block(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vehiclesService.block(id, req.tenantId);
  }

  @Post(':id/unblock')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Desbloquear veículo' })
  async unblock(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vehiclesService.unblock(id, req.tenantId);
  }
}
