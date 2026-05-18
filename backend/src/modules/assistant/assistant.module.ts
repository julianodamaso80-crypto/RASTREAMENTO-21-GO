import { Module } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { AssistantTools } from './assistant.tools';
import { VehiclesAnalyticsModule } from '../vehicles-analytics/vehicles-analytics.module';
import { ScoringModule } from '../scoring/scoring.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';

@Module({
  imports: [VehiclesAnalyticsModule, ScoringModule, MaintenanceModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantTools],
  exports: [AssistantService],
})
export class AssistantModule {}
