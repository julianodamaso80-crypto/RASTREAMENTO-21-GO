import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TraccarService } from './traccar.service';
import { TraccarController } from './traccar.controller';
import { TraccarGateway } from './traccar.gateway';
import { BleTagsModule } from '../ble-tags/ble-tags.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
    }),
    BleTagsModule,
    // forwardRef pra resolver ciclo: TraccarModule → AlertsModule (cron usa
    // TraccarService) → TraccarModule. Import faz o gateway poder injetar
    // AlertsService normalmente (já era global, mas explicitar aqui ajuda).
    forwardRef(() => AlertsModule),
  ],
  controllers: [TraccarController],
  providers: [TraccarService, TraccarGateway],
  exports: [TraccarService],
})
export class TraccarModule {}
