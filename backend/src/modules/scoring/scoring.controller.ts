import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ScoringService } from './scoring.service';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; tenantId: string; role: string };
}

@Controller()
export class ScoringController {
  constructor(private service: ScoringService) {}

  @Get('vehicles/:id/score')
  getScore(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getLatest(id, req.tenantId);
  }

  @Get('scores/ranking')
  ranking(@Req() req: AuthenticatedRequest, @Query('limit') limit?: string) {
    return this.service.ranking(req.tenantId, limit ? parseInt(limit, 10) : 100);
  }
}
