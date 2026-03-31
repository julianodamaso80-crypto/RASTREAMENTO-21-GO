import { Module } from '@nestjs/common';
import { ServerInfoService } from './server-info.service';
import { ServerInfoController } from './server-info.controller';
import { TraccarModule } from '../traccar/traccar.module';

@Module({
  imports: [TraccarModule],
  controllers: [ServerInfoController],
  providers: [ServerInfoService],
  exports: [ServerInfoService],
})
export class ServerInfoModule {}
