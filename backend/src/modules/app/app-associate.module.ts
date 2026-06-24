import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TraccarModule } from '../traccar/traccar.module';
import { AssociateAuthService } from './associate-auth.service';
import { AssociateAuthController } from './associate-auth.controller';
import { AppDataService } from './app-data.service';
import { AppDataController } from './app-data.controller';
import { AssociateJwtGuard } from './guards/associate-jwt.guard';

/**
 * Módulo do app mobile do associado (cliente final). Auth isolada por CPF + senha,
 * endpoints sob /app/* que só enxergam os veículos do próprio associado.
 */
@Module({
  imports: [
    TraccarModule,
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
  controllers: [AssociateAuthController, AppDataController],
  providers: [AssociateAuthService, AppDataService, AssociateJwtGuard],
})
export class AppAssociateModule {}
