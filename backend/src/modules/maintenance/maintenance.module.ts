import { Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceCron } from './maintenance.cron';
import { TraccarModule } from '../traccar/traccar.module';

@Module({
  imports: [TraccarModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, MaintenanceCron],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
