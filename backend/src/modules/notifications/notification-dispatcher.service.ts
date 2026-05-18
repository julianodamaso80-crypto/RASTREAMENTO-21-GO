import { Injectable, Logger } from '@nestjs/common';
import { AlertSeverity, AlertType, Role } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';

interface AlertPayload {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  data: Record<string, unknown> | null;
  vehicleId: string;
  tenantId: string;
  createdAt: Date;
  vehicle?: { plate: string; brand: string | null; model: string | null };
}

/**
 * Mapa de severidade default por tipo. Pode ser sobrescrito por TenantSettings.
 */
export const DEFAULT_SEVERITY: Record<AlertType, AlertSeverity> = {
  SPEED: AlertSeverity.WARNING,
  IGNITION_ON: AlertSeverity.INFO,
  IGNITION_OFF: AlertSeverity.INFO,
  SOS: AlertSeverity.CRITICAL,
  BATTERY_LOW: AlertSeverity.WARNING,
  OFFLINE: AlertSeverity.WARNING,
  GEOFENCE_IN: AlertSeverity.INFO,
  GEOFENCE_OUT: AlertSeverity.INFO,
  POWER_CUT: AlertSeverity.CRITICAL,
  JAMMING: AlertSeverity.CRITICAL,
  VEHICLE_BATTERY_LOW: AlertSeverity.WARNING,
  HARSH_BRAKE: AlertSeverity.INFO,
  HARSH_ACCEL: AlertSeverity.INFO,
  FUEL_THEFT: AlertSeverity.CRITICAL,
  MAINTENANCE_DUE: AlertSeverity.WARNING,
  ENGINE_OVERHEATING: AlertSeverity.WARNING,
  COLLISION: AlertSeverity.CRITICAL,
};

@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private settings: TenantSettingsService,
  ) {}

  async dispatch(alert: AlertPayload): Promise<void> {
    const settings = await this.settings.getForTenant(alert.tenantId);

    const typeEnabled = !settings.notifyTypes || settings.notifyTypes[alert.type] !== false;
    if (!typeEnabled) {
      this.logger.debug(`Notify disabled for type ${alert.type} (tenant ${alert.tenantId})`);
      return;
    }

    // Só notifica WARNING e CRITICAL por email/push por default. INFO fica só no sino.
    const shouldEmail = settings.notifyChannels.email && alert.severity !== AlertSeverity.INFO;
    const shouldPush = settings.notifyChannels.push;

    const recipients = await this.getRecipientEmails(alert.tenantId, alert.severity);

    const tasks: Promise<unknown>[] = [];
    if (shouldEmail && recipients.length > 0) {
      tasks.push(
        this.email
          .sendAlertNotification({
            to: recipients,
            alert,
          })
          .catch((err) =>
            this.logger.error(`Falha email para alerta ${alert.id}: ${(err as Error).message}`),
          ),
      );
    }
    if (shouldPush) {
      // Push é entregue pelo emitter WebSocket que já existe (alerts.service.setEmitter).
      // Este placeholder permite plugar Web Push API no futuro sem refator.
    }
    await Promise.allSettled(tasks);
  }

  private async getRecipientEmails(tenantId: string, severity: AlertSeverity) {
    const roles =
      severity === AlertSeverity.CRITICAL
        ? [Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR]
        : [Role.ADMIN, Role.OPERATOR];

    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        active: true,
        deletedAt: null,
        role: { in: roles },
      },
      select: { email: true },
    });
    return users.map((u) => u.email);
  }
}
