import { Module } from '@nestjs/common';
import { SmsCommandsService } from './sms-commands.service';
import { SmsCommandsController } from './sms-commands.controller';

@Module({
  controllers: [SmsCommandsController],
  providers: [SmsCommandsService],
  exports: [SmsCommandsService],
})
export class SmsCommandsModule {}
