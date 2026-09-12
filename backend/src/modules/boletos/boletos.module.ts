import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BoletosController } from './boletos.controller';
import { BoletosService } from './boletos.service';
import { CrmBoletosClient } from './crm-boletos.client';
import { PushService } from './push.service';
import { BoletosSyncService } from './boletos-sync.service';
import { AssociateJwtGuard } from '../app/guards/associate-jwt.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.associateSecret')!,
      }),
    }),
  ],
  controllers: [BoletosController],
  providers: [BoletosService, CrmBoletosClient, PushService, BoletosSyncService, AssociateJwtGuard],
  exports: [BoletosService, CrmBoletosClient, PushService],
})
export class BoletosModule {}
