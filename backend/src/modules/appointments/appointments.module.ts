import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AppointmentsExportService } from './appointments-export.service';

@Module({
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentsExportService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
