import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { HistoryPublicController } from './history-public.controller';
import { HistoryRequestsService } from './history-requests.service';
import { TraccarModule } from '../traccar/traccar.module';
import { GeocodingModule } from '../geocoding/geocoding.module';

@Module({
  imports: [TraccarModule, GeocodingModule],
  controllers: [ReportsController, HistoryPublicController],
  providers: [ReportsService, HistoryRequestsService],
  // O app do associado reusa o mesmo motor de viagens do painel — regra de
  // corte de trajeto tem que ser uma só nos dois lugares.
  exports: [ReportsService, HistoryRequestsService],
})
export class ReportsModule {}
