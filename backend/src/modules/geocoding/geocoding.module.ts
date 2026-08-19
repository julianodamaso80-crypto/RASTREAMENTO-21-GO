import { Module } from '@nestjs/common';
import { GeocodingController } from './geocoding.controller';
import { ReverseGeocodeService } from './reverse-geocode.service';

@Module({
  controllers: [GeocodingController],
  providers: [ReverseGeocodeService],
  exports: [ReverseGeocodeService],
})
export class GeocodingModule {}
