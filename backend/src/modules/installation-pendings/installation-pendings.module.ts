import { Module } from '@nestjs/common';
import { HinovaModule } from '../hinova/hinova.module';
import { TraccarModule } from '../traccar/traccar.module';
import { InstallationPendingsController } from './installation-pendings.controller';
import { InstallationPendingsService } from './installation-pendings.service';
import { InstallationPendingsExportService } from './installation-pendings-export.service';
import { GeocodingService } from './geocoding.service';
import { RoutesService } from './routes.service';
import { SgaMirrorService } from './sga-mirror.service';

@Module({
  imports: [HinovaModule, TraccarModule],
  controllers: [InstallationPendingsController],
  providers: [
    InstallationPendingsService,
    InstallationPendingsExportService,
    GeocodingService,
    RoutesService,
    SgaMirrorService,
  ],
  exports: [InstallationPendingsService, RoutesService, SgaMirrorService],
})
export class InstallationPendingsModule {}
