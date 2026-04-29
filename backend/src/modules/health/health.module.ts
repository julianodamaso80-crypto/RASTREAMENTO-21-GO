import { Module } from '@nestjs/common';
import { TraccarModule } from '../traccar/traccar.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TraccarModule],
  controllers: [HealthController],
})
export class HealthModule {}
