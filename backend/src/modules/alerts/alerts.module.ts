import { Global, Module, forwardRef } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { AlertsCron } from './alerts.cron';
import { TraccarModule } from '../traccar/traccar.module';

@Global()
@Module({
  // forwardRef porque TraccarModule depende de AlertsService (gateway emite alerts)
  // e AlertsCron depende de TraccarService — ciclo resolvido via forwardRef.
  imports: [forwardRef(() => TraccarModule)],
  controllers: [AlertsController],
  providers: [AlertsService, AlertsCron],
  exports: [AlertsService],
})
export class AlertsModule {}
