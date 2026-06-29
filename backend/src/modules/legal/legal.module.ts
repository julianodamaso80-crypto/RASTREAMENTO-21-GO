import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller';

/** Páginas públicas legais (política de privacidade exigida pelas lojas). */
@Module({
  controllers: [LegalController],
})
export class LegalModule {}
