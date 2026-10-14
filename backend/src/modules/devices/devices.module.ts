import { Module } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { TraccarModule } from '../traccar/traccar.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [TraccarModule, StockModule],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
