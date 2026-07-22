import { Module } from '@nestjs/common';
import { HinovaModule } from '../hinova/hinova.module';
import { InstallationPendingsController } from './installation-pendings.controller';
import { InstallationPendingsService } from './installation-pendings.service';
import { InstallationPendingsExportService } from './installation-pendings-export.service';

@Module({
  imports: [HinovaModule],
  controllers: [InstallationPendingsController],
  providers: [InstallationPendingsService, InstallationPendingsExportService],
  exports: [InstallationPendingsService],
})
export class InstallationPendingsModule {}
