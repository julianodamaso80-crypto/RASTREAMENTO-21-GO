import { Module } from '@nestjs/common';
import { ReverseGeocodeService } from './reverse-geocode.service';

@Module({
  providers: [ReverseGeocodeService],
  exports: [ReverseGeocodeService],
})
export class GeocodingModule {}
