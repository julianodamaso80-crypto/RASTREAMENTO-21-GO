import { Global, Module } from '@nestjs/common';
import { PositionsService } from './positions.service';

@Global()
@Module({
  providers: [PositionsService],
  exports: [PositionsService],
})
export class PositionsModule {}
