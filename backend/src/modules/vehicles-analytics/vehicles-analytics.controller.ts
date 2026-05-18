import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { VehiclesAnalyticsService, type BehaviorPeriod } from './vehicles-analytics.service';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; tenantId: string; role: string };
}

@Controller('vehicles')
export class VehiclesAnalyticsController {
  constructor(private service: VehiclesAnalyticsService) {}

  @Get(':id/behavior')
  getBehavior(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('period') period: BehaviorPeriod = '7d',
  ) {
    return this.service.getBehavior(id, req.tenantId, period);
  }

  @Get(':id/telemetry')
  getTelemetry(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('period') period: BehaviorPeriod = '24h',
  ) {
    return this.service.getTelemetry(id, req.tenantId, period);
  }

  @Get(':id/replay')
  getReplay(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.getReplay(id, req.tenantId, new Date(from), new Date(to));
  }
}
