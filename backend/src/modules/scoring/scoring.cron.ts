import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScoringService } from './scoring.service';

@Injectable()
export class ScoringCron {
  private readonly logger = new Logger(ScoringCron.name);

  constructor(private service: ScoringService) {}

  // 22:00 BRT, com prazo até 03:00 BRT (antes do backup das 03:00 e da purga
  // das 03:20): o recálculo lê 30 dias de posições por veículo e não pode
  // disputar o banco com o expediente (medido em 04/11/2026: 05:00 → 13:30).
  static readonly JANELA_MS = 5 * 60 * 60 * 1000;

  @Cron('0 0 22 * * *', { timeZone: 'America/Sao_Paulo' })
  async recompute() {
    this.logger.log('Recomputando scores...');
    try {
      const r = await this.service.recomputeAll(new Date(Date.now() + ScoringCron.JANELA_MS));
      this.logger.log(
        `Scores atualizados: ${r.computados} computados, ${r.pulados} já feitos` +
          (r.interrompido ? ', interrompido no prazo.' : '.'),
      );
    } catch (err) {
      this.logger.error(`Falha: ${(err as Error).message}`);
    }
  }
}
