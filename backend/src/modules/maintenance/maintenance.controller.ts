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
} from '@nestjs/common';
import { MaintenanceService, type CreatePlanDto } from './maintenance.service';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; tenantId: string; role: string };
}

@Controller('maintenance-plans')
export class MaintenanceController {
  constructor(private service: MaintenanceService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query('vehicleId') vehicleId?: string) {
    return this.service.list(req.tenantId, vehicleId);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreatePlanDto) {
    return this.service.create(req.tenantId, dto);
  }

  @Patch(':id')
  update(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: Partial<CreatePlanDto>) {
    return this.service.update(id, req.tenantId, dto);
  }

  @Post(':id/done')
  markDone(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.markDone(id, req.tenantId);
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id, req.tenantId);
  }
}
