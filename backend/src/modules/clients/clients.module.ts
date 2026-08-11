import { Module } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { AssetsSgaSyncService } from './assets-sga-sync.service';
import { AppAssociateModule } from '../app/app-associate.module';
import { HinovaModule } from '../hinova/hinova.module';

@Module({
  // AppAssociateModule traz o AssociateAuthService pro botão "Redefinir senha
  // do app"; HinovaModule traz o cliente do SGA pro sync de situação do ativo.
  imports: [AppAssociateModule, HinovaModule],
  controllers: [ClientsController],
  providers: [ClientsService, AssetsSgaSyncService],
  exports: [ClientsService],
})
export class ClientsModule {}
