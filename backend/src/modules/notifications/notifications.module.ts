import { Global, Module } from '@nestjs/common';
import { NotificationDispatcher } from './notification-dispatcher.service';

@Global()
@Module({
  providers: [NotificationDispatcher],
  exports: [NotificationDispatcher],
})
export class NotificationsModule {}
