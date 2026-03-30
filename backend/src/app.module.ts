import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantGuard } from './common/guards/tenant.guard';
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
        level: process.env.NODE_ENV !== 'production' ? 'debug' : 'info',
      },
    }),
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
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
