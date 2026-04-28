import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; role: string };
}

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Overview consolidado com KPIs, charts e tabelas (cache 60s)',
  })
  async overview(
    @Query() query: DashboardQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dashboardService.getOverview(
      req.tenantId,
      query.period ?? 'today',
    );
  }
}
