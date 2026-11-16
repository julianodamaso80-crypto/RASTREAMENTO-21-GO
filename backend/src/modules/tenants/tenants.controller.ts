import { emDemo, tenantDaDemo, MENSAGEM_DEMO } from '../../common/demo/demo-context';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Tenants')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('tenants')
export class TenantsController {
  constructor(private tenantsService: TenantsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista todas as tenants (SUPER_ADMIN)' })
  async findAll(@Query() query: PaginationQueryDto) {
    // Demonstração não enxerga as outras empresas, nem pelo nome.
    if (emDemo()) {
      const propria = await this.tenantsService.findOne(tenantDaDemo()!);
      return { data: [propria], meta: { total: 1, page: 1, perPage: query.perPage } };
    }
    return this.tenantsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes de uma tenant' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    this.somenteAPropriaNaDemo(id);
    return this.tenantsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Criar nova tenant' })
  async create(@Body() dto: CreateTenantDto) {
    if (emDemo()) throw new ForbiddenException(MENSAGEM_DEMO);
    return this.tenantsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar tenant' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
  ) {
    this.somenteAPropriaNaDemo(id);
    return this.tenantsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desativar tenant' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    if (emDemo()) throw new ForbiddenException(MENSAGEM_DEMO);
    return this.tenantsService.remove(id);
  }

  private somenteAPropriaNaDemo(id: string): void {
    if (emDemo() && id !== tenantDaDemo()) {
      throw new NotFoundException('Tenant não encontrada');
    }
  }
}
