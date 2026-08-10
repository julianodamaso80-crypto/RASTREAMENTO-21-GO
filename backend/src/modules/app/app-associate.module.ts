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
        // Segredo PRÓPRIO. Não é o do painel — é isso que torna um token de
        // cliente inválido do outro lado já na verificação da assinatura.
        secret: config.get<string>('jwt.associateSecret')!,
        signOptions: {
          expiresIn: config.get<string>('jwt.expiration')! as any,
        },
      }),
    }),
  ],
  controllers: [AssociateAuthController, AppDataController],
  providers: [AssociateAuthService, AppDataService, AssociateJwtGuard],
  // O painel (ClientsModule) reusa o mesmo motor de senha pra atender o cliente
  // que perdeu o acesso — uma regra de senha só, num lugar só.
  exports: [AssociateAuthService],
})
export class AppAssociateModule {}
