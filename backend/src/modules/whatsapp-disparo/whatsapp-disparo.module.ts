import { Module } from '@nestjs/common';
import { AvisoRastreadorService } from './aviso-rastreador.service';

/** Mensagens automáticas pelo número de disparo da 21 Go (21 98481-6000). */
@Module({
  providers: [AvisoRastreadorService],
  exports: [AvisoRastreadorService],
})
export class WhatsappDisparoModule {}
