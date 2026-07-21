import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StockModule } from '../stock/stock.module';
import { TraccarModule } from '../traccar/traccar.module';
import { HinovaModule } from '../hinova/hinova.module';
import { TechAuthService } from './tech-auth.service';
import { TechAuthController } from './tech-auth.controller';
import { TechFieldService } from './tech-field.service';
import { TechFieldController } from './tech-field.controller';
import { TechnicianJwtGuard } from './guards/technician-jwt.guard';

/**
 * PWA do técnico instalador (/tecnico). Auth por CPF + senha, rotas sob /tech/*
 * que só enxergam os equipamentos reservados pro próprio técnico. A finalização
 * de instalação reusa o StockService — mesma regra do painel, um lugar só.
 */
@Module({
  imports: [
    StockModule,
    TraccarModule,
    HinovaModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret')!,
        signOptions: {
          expiresIn: config.get<string>('jwt.expiration')! as any,
        },
      }),
    }),
  ],
  controllers: [TechAuthController, TechFieldController],
  providers: [TechAuthService, TechFieldService, TechnicianJwtGuard],
})
export class TechModule {}
