import { Global, Module } from '@nestjs/common';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { WhatsappService } from './whatsapp.service';

@Global()
@Module({
  providers: [NotificationDispatcher, WhatsappService],
  exports: [NotificationDispatcher, WhatsappService],
})
export class NotificationsModule {}
