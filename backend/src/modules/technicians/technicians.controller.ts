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
import { TechniciansService } from './technicians.service';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { UpdateTechnicianDto } from './dto/update-technician.dto';

interface AuthenticatedRequest {
  tenantId: string;
}

@ApiTags('Técnicos')
@ApiBearerAuth()
@Controller('technicians')
export class TechniciansController {
  constructor(private service: TechniciansService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista técnicos com contagem de reservas e instalações',
  })
  findAll(
    @Query('search') search: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.findAll(req.tenantId, search);
  }

  @Get(':id/assignments')
  @ApiOperation({ summary: 'Equipamentos reservados pro técnico' })
  assignments(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.assignments(id, req.tenantId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({
    summary: 'Cadastra técnico e devolve a senha provisória (uma única vez)',
  })
  create(@Body() dto: CreateTechnicianDto, @Req() req: AuthenticatedRequest) {
    return this.service.create(req.tenantId, dto);
  }

  @Post(':id/reset-password')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Gera nova senha provisória' })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.resetPassword(id, req.tenantId);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Atualiza dados do técnico' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTechnicianDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.update(id, req.tenantId, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Remove técnico (soft delete)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.remove(id, req.tenantId);
  }
}
