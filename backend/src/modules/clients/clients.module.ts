import { Module } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { AppAssociateModule } from '../app/app-associate.module';

@Module({
  // Traz o AssociateAuthService pro botão "Redefinir senha do app" no painel.
  imports: [AppAssociateModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
