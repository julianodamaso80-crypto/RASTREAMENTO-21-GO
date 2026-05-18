import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScoringService } from './scoring.service';

@Injectable()
export class ScoringCron {
  private readonly logger = new Logger(ScoringCron.name);

  constructor(private service: ScoringService) {}

  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async recompute() {
    this.logger.log('Recomputando scores...');
    try {
      await this.service.recomputeAll();
      this.logger.log('Scores atualizados.');
    } catch (err) {
      this.logger.error(`Falha: ${(err as Error).message}`);
    }
  }
}
