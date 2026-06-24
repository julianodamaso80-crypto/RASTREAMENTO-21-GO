import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import configuration from './config/configuration';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TraccarModule } from './modules/traccar/traccar.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { HinovaModule } from './modules/hinova/hinova.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { ReportsModule } from './modules/reports/reports.module';
import { GeofencesModule } from './modules/geofences/geofences.module';
import { DevicesModule } from './modules/devices/devices.module';
import { BleTagsModule } from './modules/ble-tags/ble-tags.module';
import { ChipsModule } from './modules/chips/chips.module';
import { SmsCommandsModule } from './modules/sms-commands/sms-commands.module';
import { ServerInfoModule } from './modules/server-info/server-info.module';
import { HealthModule } from './modules/health/health.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EmailModule } from './modules/email/email.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { PositionsModule } from './modules/positions/positions.module';
import { TenantSettingsModule } from './modules/tenant-settings/tenant-settings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { VehiclesAnalyticsModule } from './modules/vehicles-analytics/vehicles-analytics.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { AppAssociateModule } from './modules/app/app-associate.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { TenantThrottlerGuard } from './common/guards/tenant-throttler.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        // Em prod, 'info' loga TODA request HTTP (>500MB/dia em 20k ativos).
        // 'warn' mantém só erros e warnings — suficiente pra observability + reduz custo.
        // Override via env LOG_LEVEL pra debug pontual sem rebuild.
        level:
          process.env.LOG_LEVEL ||
          (process.env.NODE_ENV === 'production' ? 'warn' : 'debug'),
      },
    }),
    // 100 req/min por tenant (operador) ou IP (rotas públicas).
    // Custom guard em `TenantThrottlerGuard` distingue os dois.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    TraccarModule,
    VehiclesModule,
    TenantsModule,
    HinovaModule,
    AlertsModule,
    ReportsModule,
    GeofencesModule,
    DevicesModule,
    BleTagsModule,
    ChipsModule,
    SmsCommandsModule,
    ServerInfoModule,
    HealthModule,
    DashboardModule,
    EmailModule,
    AdminModule,
    AuditModule,
    PositionsModule,
    TenantSettingsModule,
    NotificationsModule,
    VehiclesAnalyticsModule,
    MaintenanceModule,
    ScoringModule,
    AssistantModule,
    AppAssociateModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: TenantThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
