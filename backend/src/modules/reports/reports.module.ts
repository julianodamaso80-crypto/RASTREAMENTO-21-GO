import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { TraccarModule } from '../traccar/traccar.module';

@Module({
  imports: [TraccarModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  // O app do associado reusa o mesmo motor de viagens do painel — regra de
  // corte de trajeto tem que ser uma só nos dois lugares.
  exports: [ReportsService],
})
export class ReportsModule {}
