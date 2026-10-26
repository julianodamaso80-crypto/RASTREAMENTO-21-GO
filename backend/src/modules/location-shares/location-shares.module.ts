import { Module } from '@nestjs/common';
import { TraccarModule } from '../traccar/traccar.module';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { LocationSharesService } from './location-shares.service';
import { LocationSharesController } from './location-shares.controller';
import { LocationSharePublicController } from './location-share-public.controller';

@Module({
  imports: [TraccarModule, GeocodingModule],
  controllers: [LocationSharesController, LocationSharePublicController],
  providers: [LocationSharesService],
  exports: [LocationSharesService],
})
export class LocationSharesModule {}
