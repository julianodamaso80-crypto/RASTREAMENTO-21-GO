import { Global, Module } from '@nestjs/common';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { WhatsappService } from './whatsapp.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { PhoneVerificationService } from '../auth/phone-verification.service';

/**
 * Global: o motor de recuperação de senha é o mesmo para o painel, o app do
 * associado e o PWA do técnico. Mora junto do WhatsappService, de quem depende.
 */
@Global()
@Module({
  providers: [
    NotificationDispatcher,
    WhatsappService,
    PasswordResetService,
    PhoneVerificationService,
  ],
  exports: [
    NotificationDispatcher,
    WhatsappService,
    PasswordResetService,
    PhoneVerificationService,
  ],
})
export class NotificationsModule {}
