import { Global, Module } from '@nestjs/common';
import { GeofencesService } from './geofences.service';
import { GeofencesController } from './geofences.controller';
import { TraccarModule } from '../traccar/traccar.module';

@Global()
@Module({
  imports: [TraccarModule],
  controllers: [GeofencesController],
  providers: [GeofencesService],
  exports: [GeofencesService],
})
export class GeofencesModule {}
