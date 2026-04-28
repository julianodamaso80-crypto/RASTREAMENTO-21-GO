import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; role: Role };
}

const SOFT_DELETE_ENTITIES = {
  tenant: 'tenant',
  user: 'user',
  vehicle: 'vehicle',
  associate: 'associate',
  alert: 'alert',
  geofence: 'geofence',
  device: 'device',
  chip: 'chip',
} as const;

type SoftDeleteEntity = keyof typeof SOFT_DELETE_ENTITIES;

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('deleted/:entity')
  @ApiOperation({
    summary: 'Lista registros soft-deleted de uma entidade (SUPER_ADMIN)',
  })
  @ApiParam({ name: 'entity', enum: Object.keys(SOFT_DELETE_ENTITIES) })
  @ApiQuery({ name: 'tenantId', required: false, type: String })
  async listDeleted(
    @Param('entity') entity: string,
    @Query('tenantId') tenantIdQuery: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const model = this.resolveModel(entity);
    const tenantId = tenantIdQuery ?? req.tenantId;

    const where: Record<string, unknown> = { deletedAt: { not: null } };
    if (entity !== 'tenant' && tenantId) {
      where.tenantId = tenantId;
    }

    const rows = await (
      model as unknown as {
        findMany: (args: unknown) => Promise<unknown[]>;
      }
    ).findMany({
      where,
      orderBy: { deletedAt: 'desc' },
      take: 100,
    });

    return { entity, count: rows.length, rows };
  }

  @Post('restore/:entity/:id')
  @ApiOperation({
    summary: 'Restaura registro soft-deleted (SUPER_ADMIN)',
  })
  @ApiParam({ name: 'entity', enum: Object.keys(SOFT_DELETE_ENTITIES) })
  @ApiParam({ name: 'id', type: String })
  async restore(@Param('entity') entity: string, @Param('id') id: string) {
    const model = this.resolveModel(entity);

    const target = await (
      model as unknown as {
        findFirst: (args: unknown) => Promise<unknown>;
      }
    ).findFirst({
      where: { id, deletedAt: { not: null } },
    });

    if (!target) {
      throw new NotFoundException(
        `${entity} ${id} não encontrado ou não está soft-deleted`,
      );
    }

    const restored = await (
      model as unknown as {
        update: (args: unknown) => Promise<unknown>;
      }
    ).update({
      where: { id },
      data: { deletedAt: null },
    });

    return { restored };
  }

  private resolveModel(entity: string) {
    if (!(entity in SOFT_DELETE_ENTITIES)) {
      throw new BadRequestException(
        `Entidade inválida. Permitidas: ${Object.keys(SOFT_DELETE_ENTITIES).join(', ')}`,
      );
    }
    const key = entity as SoftDeleteEntity;
    return this.prisma[key];
  }
}
