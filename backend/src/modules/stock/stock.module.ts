import { Module } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockController } from './stock.controller';
import { HinovaModule } from '../hinova/hinova.module';
import { TraccarModule } from '../traccar/traccar.module';

@Module({
  imports: [HinovaModule, TraccarModule],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
