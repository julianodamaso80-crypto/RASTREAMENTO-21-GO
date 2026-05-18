import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { TenantSettingsService, ResolvedSettings } from './tenant-settings.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '.prisma/client';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; tenantId: string; role: string };
}

@Controller('settings')
export class TenantSettingsController {
  constructor(private service: TenantSettingsService) {}

  @Get()
  get(@Req() req: AuthenticatedRequest) {
    return this.service.getForTenant(req.tenantId);
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  update(@Req() req: AuthenticatedRequest, @Body() body: Partial<ResolvedSettings>) {
    return this.service.upsert(req.tenantId, body);
  }
}
