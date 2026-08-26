import { Module } from '@nestjs/common';
import { BleTagsService } from './ble-tags.service';
import { BleTagsController } from './ble-tags.controller';
import { TraccarModule } from '../traccar/traccar.module';

@Module({
  imports: [TraccarModule],
  controllers: [BleTagsController],
  providers: [BleTagsService],
  exports: [BleTagsService],
})
export class BleTagsModule {}
