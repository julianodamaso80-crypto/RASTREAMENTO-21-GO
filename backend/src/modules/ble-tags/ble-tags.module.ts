import { Module } from '@nestjs/common';
import { BleTagsService } from './ble-tags.service';
import { BleTagsController } from './ble-tags.controller';

@Module({
  controllers: [BleTagsController],
  providers: [BleTagsService],
  exports: [BleTagsService],
})
export class BleTagsModule {}
