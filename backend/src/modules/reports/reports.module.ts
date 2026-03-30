import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { TraccarModule } from '../traccar/traccar.module';

@Module({
  imports: [TraccarModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
