import { Module, forwardRef } from '@nestjs/common';
import { BleTagsService } from './ble-tags.service';
import { BleTagsController } from './ble-tags.controller';
import { TraccarModule } from '../traccar/traccar.module';

@Module({
  // forwardRef obrigatório: o TraccarModule já importa este módulo (o gateway
  // publica as detecções BLE), então importar de volta sem isso trava o boot
  // inteiro do backend com UndefinedModuleException.
  imports: [forwardRef(() => TraccarModule)],
  controllers: [BleTagsController],
  providers: [BleTagsService],
  exports: [BleTagsService],
})
export class BleTagsModule {}
