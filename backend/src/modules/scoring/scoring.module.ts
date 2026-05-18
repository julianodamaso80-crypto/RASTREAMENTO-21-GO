import { Module } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { ScoringController } from './scoring.controller';
import { ScoringCron } from './scoring.cron';

@Module({
  controllers: [ScoringController],
  providers: [ScoringService, ScoringCron],
  exports: [ScoringService],
})
export class ScoringModule {}
