import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MaintenanceService } from './maintenance.service';

@Injectable()
export class MaintenanceCron {
  private readonly logger = new Logger(MaintenanceCron.name);

  constructor(private service: MaintenanceService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async evaluateAll() {
    this.logger.log('Avaliando planos de manutenção...');
    try {
      await this.service.evaluateAll();
      this.logger.log('Avaliação completa.');
    } catch (err) {
      this.logger.error(`Falha na avaliação: ${(err as Error).message}`);
    }
  }
}
