import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AuditAction, Role, Prisma } from '.prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; role: Role };
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/audit')
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista registros de auditoria (SUPER_ADMIN vê todos; ADMIN só do próprio tenant)',
  })
  @ApiQuery({ name: 'tenantId', required: false, type: String })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiQuery({ name: 'action', required: false, enum: AuditAction })
  @ApiQuery({ name: 'entity', required: false, type: String })
  @ApiQuery({ name: 'entityId', required: false, type: String })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    description: 'ISO date',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    type: String,
    description: 'ISO date',
  })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('tenantId') tenantIdQuery?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: AuditAction,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    const where: Prisma.AuditLogWhereInput = {};

    // ADMIN é sempre escopado ao próprio tenant — ignora tenantIdQuery.
    // SUPER_ADMIN pode filtrar por tenantId específico ou ver tudo.
    if (req.user.role === Role.SUPER_ADMIN) {
      if (tenantIdQuery) where.tenantId = tenantIdQuery;
    } else if (req.user.role === Role.ADMIN) {
      where.tenantId = req.tenantId;
    } else {
      throw new ForbiddenException('Acesso negado');
    }

    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (entityId) where.entityId = entityId;

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const takeNum = Math.min(Number(take) || 50, 200);
    const skipNum = Math.max(Number(skip) || 0, 0);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: takeNum,
        skip: skipNum,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { total, count: rows.length, rows };
  }
}
