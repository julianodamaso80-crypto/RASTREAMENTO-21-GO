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
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { GeofencesService } from './geofences.service';
import { CreateGeofenceDto, UpdateGeofenceDto, LinkVehiclesDto } from './dto/create-geofence.dto';

interface AuthenticatedRequest {
  tenantId: string;
}

@ApiTags('Geofencing')
@ApiBearerAuth()
@Controller('geofences')
export class GeofencesController {
  constructor(private geofencesService: GeofencesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista cercas geográficas' })
  async findAll(@Query() query: PaginationQueryDto, @Req() req: AuthenticatedRequest) {
    return this.geofencesService.findAll(req.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes de uma cerca' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.geofencesService.findOne(id, req.tenantId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Criar cerca geográfica' })
  async create(@Body() dto: CreateGeofenceDto, @Req() req: AuthenticatedRequest) {
    return this.geofencesService.create(dto, req.tenantId);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Atualizar cerca' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGeofenceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.geofencesService.update(id, dto, req.tenantId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Remover cerca' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.geofencesService.remove(id, req.tenantId);
  }

  @Post(':id/vehicles')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Vincular veículos à cerca' })
  async linkVehicles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkVehiclesDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.geofencesService.linkVehicles(id, dto.vehicleIds, req.tenantId);
  }
}
