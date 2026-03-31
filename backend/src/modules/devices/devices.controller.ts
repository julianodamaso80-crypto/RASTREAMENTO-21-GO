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
import { DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { FilterDevicesDto } from './dto/filter-devices.dto';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; role: string };
}

@ApiTags('Dispositivos')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private devicesService: DevicesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista dispositivos (paginado, com filtros)' })
  async findAll(@Query() filters: FilterDevicesDto, @Req() req: AuthenticatedRequest) {
    return this.devicesService.findAll(req.tenantId, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes do dispositivo com chip e veículo' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.devicesService.findOne(id, req.tenantId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Cadastrar novo rastreador' })
  async create(@Body() dto: CreateDeviceDto, @Req() req: AuthenticatedRequest) {
    return this.devicesService.create(dto, req.tenantId);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Atualizar dispositivo' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.devicesService.update(id, dto, req.tenantId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Remover dispositivo (soft delete)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.devicesService.remove(id, req.tenantId);
  }

  @Post(':id/link-vehicle/:vehicleId')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Vincular dispositivo a veículo' })
  async linkVehicle(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.devicesService.linkVehicle(id, vehicleId, req.tenantId);
  }

  @Post(':id/unlink-vehicle')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Desvincular dispositivo do veículo' })
  async unlinkVehicle(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.devicesService.unlinkVehicle(id, req.tenantId);
  }

  @Post(':id/link-chip/:chipId')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Vincular chip ao dispositivo' })
  async linkChip(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('chipId', ParseUUIDPipe) chipId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.devicesService.linkChip(id, chipId, req.tenantId);
  }

  @Post(':id/unlink-chip')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Desvincular chip do dispositivo' })
  async unlinkChip(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.devicesService.unlinkChip(id, req.tenantId);
  }

  @Get(':id/connection-status')
  @ApiOperation({ summary: 'Status de conexão do dispositivo' })
  async connectionStatus(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.devicesService.getConnectionStatus(id, req.tenantId);
  }
}
