import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HINOVA_CLIENT } from './hinova.interface';
import { HinovaService } from './hinova.service';
import { HinovaMockService } from './hinova-mock.service';
import { HinovaSyncService } from './hinova-sync.service';
import { HinovaController } from './hinova.controller';
import { emDemo } from '../../common/demo/demo-context';

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
        const real = new HinovaService(configService);
        const simulado = new HinovaMockService();
        // Empresa de demonstração nunca consulta o SGA real: responde com o
        // simulador. Um Proxy aqui cobre TODO quem injeta HINOVA_CLIENT
        // (controller, estoque, pendências, espelho, troca de titularidade).
        return new Proxy(real, {
          get(alvo, prop, receptor) {
            const origem = emDemo() ? simulado : alvo;
            const valor = Reflect.get(origem, prop, origem === alvo ? receptor : origem);
            return typeof valor === 'function' ? valor.bind(origem) : valor;
          },
        });
      },
      inject: [ConfigService],
    },
    HinovaSyncService,
  ],
  exports: [HINOVA_CLIENT, HinovaSyncService],
})
export class HinovaModule {}
