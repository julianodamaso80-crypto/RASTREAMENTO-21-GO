import {
  Controller,
  Get,
  Post,
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
import { BleTagsService } from './ble-tags.service';
import { CreateSightingDto } from './dto/create-sighting.dto';
import { FilterSightingsDto } from './dto/filter-sightings.dto';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; role: string };
}

@ApiTags('Etiquetas BLE')
@ApiBearerAuth()
@Controller('ble-tags')
export class BleTagsController {
  constructor(private bleTagsService: BleTagsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista TAGs BLE do tenant (com última detecção)',
  })
  async findAll(@Req() req: AuthenticatedRequest) {
    return this.bleTagsService.findAll(req.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes de uma TAG BLE' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bleTagsService.findOne(id, req.tenantId);
  }

  @Get(':id/sightings')
  @ApiOperation({ summary: 'Histórico de detecções da TAG (paginado)' })
  async listSightings(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() filters: FilterSightingsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bleTagsService.listSightings(id, req.tenantId, filters);
  }

  @Post('sightings')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({
    summary:
      'Registrar uma detecção BLE (chamado pelo scanner Python que escaneia o BLE local)',
  })
  async createSighting(
    @Body() dto: CreateSightingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bleTagsService.createSighting(dto, req.tenantId);
  }
}
