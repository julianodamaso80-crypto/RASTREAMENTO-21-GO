import { Module } from '@nestjs/common';
import { VehiclesAnalyticsService } from './vehicles-analytics.service';
import { VehiclesAnalyticsController } from './vehicles-analytics.controller';
import { TraccarModule } from '../traccar/traccar.module';

@Module({
  imports: [TraccarModule],
  controllers: [VehiclesAnalyticsController],
  providers: [VehiclesAnalyticsService],
  exports: [VehiclesAnalyticsService],
})
export class VehiclesAnalyticsModule {}
