import { Module } from '@nestjs/common';
import { ConsultantsController } from './consultants.controller';
import { ConsultantsService } from './consultants.service';
import { PowerPanelClient } from './power-panel.client';

@Module({
  controllers: [ConsultantsController],
  providers: [ConsultantsService, PowerPanelClient],
})
export class ConsultantsModule {}
