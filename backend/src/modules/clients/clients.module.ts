import { Module } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { AssetsSgaSyncService } from './assets-sga-sync.service';
import { OwnershipTransferService } from './ownership-transfer.service';
import { AppAssociateModule } from '../app/app-associate.module';
import { HinovaModule } from '../hinova/hinova.module';
import { StockModule } from '../stock/stock.module';

@Module({
  // AppAssociateModule traz o AssociateAuthService pro botão "Redefinir senha
  // do app"; HinovaModule traz o cliente do SGA pro sync de situação do ativo;
  // StockModule traz o lookup do SGA que a troca de titularidade reaproveita.
  imports: [AppAssociateModule, HinovaModule, StockModule],
  controllers: [ClientsController],
  providers: [ClientsService, AssetsSgaSyncService, OwnershipTransferService],
  exports: [ClientsService],
})
export class ClientsModule {}
