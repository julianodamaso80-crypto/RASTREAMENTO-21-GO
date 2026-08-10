import { Module } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockTraccarService } from './stock-traccar.service';
import { StockController } from './stock.controller';
import { HinovaModule } from '../hinova/hinova.module';
import { TraccarModule } from '../traccar/traccar.module';
import { InstallationPendingsModule } from '../installation-pendings/installation-pendings.module';

@Module({
  imports: [HinovaModule, TraccarModule, InstallationPendingsModule],
  controllers: [StockController],
  providers: [StockService, StockTraccarService],
  exports: [StockService, StockTraccarService],
})
export class StockModule {}
