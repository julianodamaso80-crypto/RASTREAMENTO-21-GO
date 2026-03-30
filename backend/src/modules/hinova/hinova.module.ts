import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HINOVA_CLIENT } from './hinova.interface';
import { HinovaService } from './hinova.service';
import { HinovaMockService } from './hinova-mock.service';
import { HinovaSyncService } from './hinova-sync.service';
import { HinovaController } from './hinova.controller';

@Module({
  controllers: [HinovaController],
  providers: [
    {
      provide: HINOVA_CLIENT,
      useFactory: (configService: ConfigService) => {
        const useMock = configService.get<boolean>('hinova.mock');
        if (useMock) {
          return new HinovaMockService();
        }
        return new HinovaService(configService);
      },
      inject: [ConfigService],
    },
    HinovaSyncService,
  ],
  exports: [HINOVA_CLIENT, HinovaSyncService],
})
export class HinovaModule {}
