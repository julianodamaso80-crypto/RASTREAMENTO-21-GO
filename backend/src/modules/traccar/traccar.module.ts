import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TraccarService } from './traccar.service';
import { TraccarController } from './traccar.controller';
import { TraccarGateway } from './traccar.gateway';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [TraccarController],
  providers: [TraccarService, TraccarGateway],
  exports: [TraccarService],
})
export class TraccarModule {}
