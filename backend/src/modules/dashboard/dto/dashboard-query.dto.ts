import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export type DashboardPeriod = 'today' | '7d' | '30d';

export class DashboardQueryDto {
  @ApiPropertyOptional({ enum: ['today', '7d', '30d'], default: 'today' })
  @IsOptional()
  @IsIn(['today', '7d', '30d'])
  period?: DashboardPeriod = 'today';
}
