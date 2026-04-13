import { Module } from '@nestjs/common';
import { TraccarModule } from '../traccar/traccar.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { TtlCache } from '../../common/cache/ttl-cache';

@Module({
  imports: [TraccarModule],
  controllers: [DashboardController],
  providers: [DashboardService, TtlCache],
})
export class DashboardModule {}
