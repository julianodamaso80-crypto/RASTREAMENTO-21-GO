import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertHistoryAction,
  AlertSeverity,
  AlertStatus,
  AlertType,
  Prisma,
} from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GeofencesService } from '../geofences/geofences.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { NotificationDispatcher, DEFAULT_SEVERITY } from '../notifications/notification-dispatcher.service';
import type { FilterAlertsDto } from './dto/filter-alerts.dto';
import type { TraccarPosition, TraccarPositionAttributes } from '../traccar/traccar.service';

type AlertEmitter = (tenantId: string, alert: Record<string, unknown>) => void;

interface ActorInfo {
  userId: string;
  email?: string | null;
}

interface VehicleState {
  ignition: boolean | null;
  speed: number;
  deviceTime: number;
  powerCutOpen: boolean;
  jammingOpen: boolean;
  jammingConsecutive: number;
  vehicleBatteryLowSince: number | null;
  vehicleBatteryAlerted: boolean;
}

const NO_DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private ignitionState = new Map<number, boolean>();
  private geofenceState = new Map<number, Set<string>>();
  private vehicleState = new Map<string, VehicleState>();
  private emitter: AlertEmitter | null = null;

  constructor(
    private prisma: PrismaService,
    private geofencesService: GeofencesService,
    private settings: TenantSettingsService,
    private dispatcher: NotificationDispatcher,
  ) {}

  setEmitter(emitter: AlertEmitter) {
    this.emitter = emitter;
  }

  async processPosition(
    position: TraccarPosition,
    vehicleId: string,
    tenantId: string,
  ) {
    const settings = await this.settings.getForTenant(tenantId);
    const attrs = (position.attributes ?? {}) as TraccarPositionAttributes;
    const speedKmh = (position.speed ?? 0) * 1.852;
    const ignition = typeof attrs.ignition === 'boolean' ? attrs.ignition : null;
    const state = this.getOrInitState(vehicleId);

    // 1) Excesso de velocidade
    if (speedKmh > settings.speedThresholdKmh) {
      await this.createAlert(
        AlertType.SPEED,
        vehicleId,
        tenantId,
        `Velocidade de ${Math.round(speedKmh)} km/h detectada`,
        { speed: Math.round(speedKmh), latitude: position.latitude, longitude: position.longitude },
      );
    }

    // 2) Ignição
    if (ignition !== null) {
      const previousIgnition = this.ignitionState.get(position.deviceId);
      if (previousIgnition === false && ignition === true) {
        await this.createAlert(
          AlertType.IGNITION_ON,
          vehicleId,
          tenantId,
          'Ignição ligada',
          { latitude: position.latitude, longitude: position.longitude },
        );
      }
      if (previousIgnition === true && ignition === false) {
        await this.createAlert(
          AlertType.IGNITION_OFF,
          vehicleId,
          tenantId,
          'Ignição desligada',
          { latitude: position.latitude, longitude: position.longitude },
        );
      }
      this.ignitionState.set(position.deviceId, ignition);
    }

    // 3) Sabotagem: corte de energia
    if (attrs.powerCut === true && !state.powerCutOpen) {
      const recent = await this.hasRecentAlert(vehicleId, AlertType.POWER_CUT, NO_DUPLICATE_WINDOW_MS);
      if (!recent) {
        await this.createAlert(
          AlertType.POWER_CUT,
          vehicleId,
          tenantId,
          'Corte de energia detectado no rastreador',
          { latitude: position.latitude, longitude: position.longitude },
        );
        state.powerCutOpen = true;
      }
    } else if (attrs.powerCut === false) {
      state.powerCutOpen = false;
    }

    // 4) Jamming (interferência GSM)
    if (attrs.jamming === true) {
      state.jammingConsecutive += 1;
      if (state.jammingConsecutive >= settings.jammingConfirmReadings && !state.jammingOpen) {
        const recent = await this.hasRecentAlert(vehicleId, AlertType.JAMMING, NO_DUPLICATE_WINDOW_MS);
        if (!recent) {
          await this.createAlert(
            AlertType.JAMMING,
            vehicleId,
            tenantId,
            'Possível bloqueador de sinal próximo (jamming)',
            { latitude: position.latitude, longitude: position.longitude },
          );
          state.jammingOpen = true;
        }
      }
    } else {
      state.jammingConsecutive = 0;
      state.jammingOpen = false;
    }

    // 5) Colisão / choque
    if (attrs.collision === true || attrs.jarring === true) {
      const recent = await this.hasRecentAlert(vehicleId, AlertType.COLLISION, 5 * 60 * 1000);
      if (!recent) {
        await this.createAlert(
          AlertType.COLLISION,
          vehicleId,
          tenantId,
          'Choque/colisão detectado',
          { latitude: position.latitude, longitude: position.longitude },
        );
      }
    }

    // 6) SOS
    if (attrs.sos === true) {
      const recent = await this.hasRecentAlert(vehicleId, AlertType.SOS, 5 * 60 * 1000);
      if (!recent) {
        await this.createAlert(
          AlertType.SOS,
          vehicleId,
          tenantId,
          'Botão de pânico acionado',
          { latitude: position.latitude, longitude: position.longitude },
        );
      }
    }

    // 7) Bateria do veículo fraca (volts)
    const powerVolts = typeof attrs.power === 'number' ? attrs.power : null;
    if (powerVolts !== null) {
      const threshold = settings.batteryVehicleLowVolts;
      const lowNow = powerVolts < threshold;
      if (lowNow) {
        if (state.vehicleBatteryLowSince === null) {
          state.vehicleBatteryLowSince = Date.now();
        }
        const fiveMin = 5 * 60 * 1000;
        if (
          !state.vehicleBatteryAlerted &&
          Date.now() - (state.vehicleBatteryLowSince ?? Date.now()) >= fiveMin
        ) {
          await this.createAlert(
            AlertType.VEHICLE_BATTERY_LOW,
            vehicleId,
            tenantId,
            `Bateria do veículo em ${powerVolts.toFixed(1)}V (abaixo de ${threshold}V)`,
            { volts: powerVolts, threshold, latitude: position.latitude, longitude: position.longitude },
          );
          state.vehicleBatteryAlerted = true;
        }
      } else if (powerVolts >= threshold + 0.5) {
        state.vehicleBatteryLowSince = null;
        state.vehicleBatteryAlerted = false;
      }
    }

    // 8) Motor superaquecendo
    const temp = typeof attrs.temperature === 'number'
      ? attrs.temperature
      : typeof attrs.temp1 === 'number'
        ? attrs.temp1
        : null;
    if (temp !== null && temp > settings.engineOverheatCelsius) {
      const recent = await this.hasRecentAlert(vehicleId, AlertType.ENGINE_OVERHEATING, 30 * 60 * 1000);
      if (!recent) {
        await this.createAlert(
          AlertType.ENGINE_OVERHEATING,
          vehicleId,
          tenantId,
          `Temperatura do motor em ${Math.round(temp)}°C`,
          { temperature: temp, latitude: position.latitude, longitude: position.longitude },
        );
      }
    }

    // 9) Análise de condução: frenagem / aceleração brusca
    await this.detectHarshDriving(position, vehicleId, tenantId, settings, state, speedKmh, ignition);

    // 10) Geofences (mantém comportamento anterior)
    await this.checkGeofences(position, vehicleId, tenantId);

    // Atualiza estado pra próxima posição
    state.speed = speedKmh;
    state.ignition = ignition;
    state.deviceTime = new Date(position.deviceTime || position.serverTime).getTime();
  }

  private async detectHarshDriving(
    position: TraccarPosition,
    vehicleId: string,
    tenantId: string,
    settings: { harshBrakeKmhPerSec: number; harshAccelKmhPerSec: number },
    state: VehicleState,
    speedKmh: number,
    ignition: boolean | null,
  ) {
    // Só analisa com ignição ligada, GPS confiável, e velocidade significativa em ambas as pontas
    if (ignition !== true) return;
    if ((position.accuracy ?? 0) > 30) return;
    if (state.speed < 5 || speedKmh < 5) return;
    if (state.deviceTime === 0) return;

    const dtSec = (new Date(position.deviceTime || position.serverTime).getTime() - state.deviceTime) / 1000;
    if (dtSec <= 0 || dtSec > 30) return;

    const accel = (speedKmh - state.speed) / dtSec;
    if (accel < settings.harshBrakeKmhPerSec) {
      await this.createAlert(
        AlertType.HARSH_BRAKE,
        vehicleId,
        tenantId,
        `Frenagem brusca: ${Math.abs(accel).toFixed(1)} km/h por segundo`,
        { acceleration: accel, fromKmh: state.speed, toKmh: speedKmh },
      );
    } else if (accel > settings.harshAccelKmhPerSec) {
      await this.createAlert(
        AlertType.HARSH_ACCEL,
        vehicleId,
        tenantId,
        `Aceleração brusca: ${accel.toFixed(1)} km/h por segundo`,
        { acceleration: accel, fromKmh: state.speed, toKmh: speedKmh },
      );
    }
  }

  private getOrInitState(vehicleId: string): VehicleState {
    let s = this.vehicleState.get(vehicleId);
    if (!s) {
      s = {
        ignition: null,
        speed: 0,
        deviceTime: 0,
        powerCutOpen: false,
        jammingOpen: false,
        jammingConsecutive: 0,
        vehicleBatteryLowSince: null,
        vehicleBatteryAlerted: false,
      };
      this.vehicleState.set(vehicleId, s);
    }
    return s;
  }

  private async hasRecentAlert(vehicleId: string, type: AlertType, windowMs: number): Promise<boolean> {
    const since = new Date(Date.now() - windowMs);
    const found = await this.prisma.alert.findFirst({
      where: {
        vehicleId,
        type,
        createdAt: { gte: since },
        status: { not: AlertStatus.RESOLVED },
      },
      select: { id: true },
    });
    return !!found;
  }

  private async checkGeofences(
    position: TraccarPosition,
    vehicleId: string,
    tenantId: string,
  ) {
    try {
      const geofences = await this.geofencesService.getVehicleGeofences(vehicleId, tenantId);
      if (geofences.length === 0) return;

      const previousInside = this.geofenceState.get(position.deviceId) || new Set<string>();
      const currentInside = new Set<string>();

      for (const geofence of geofences) {
        const inside = this.geofencesService.isPointInGeofence(
          position.latitude,
          position.longitude,
          geofence,
        );
        if (inside) currentInside.add(geofence.id);

        if (inside && !previousInside.has(geofence.id)) {
          await this.createAlert(
            AlertType.GEOFENCE_IN,
            vehicleId,
            tenantId,
            `Entrou na cerca "${geofence.name}"`,
            {
              geofenceId: geofence.id,
              geofenceName: geofence.name,
              latitude: position.latitude,
              longitude: position.longitude,
            },
          );
        }
        if (!inside && previousInside.has(geofence.id)) {
          await this.createAlert(
            AlertType.GEOFENCE_OUT,
            vehicleId,
            tenantId,
            `Saiu da cerca "${geofence.name}"`,
            {
              geofenceId: geofence.id,
              geofenceName: geofence.name,
              latitude: position.latitude,
              longitude: position.longitude,
            },
          );
        }
      }
      this.geofenceState.set(position.deviceId, currentInside);
    } catch (error) {
      this.logger.error(`Erro ao verificar geofences: ${error}`);
    }
  }

  async createAlert(
    type: AlertType,
    vehicleId: string,
    tenantId: string,
    message: string,
    data: Record<string, unknown>,
  ) {
    try {
      const severity = DEFAULT_SEVERITY[type] ?? AlertSeverity.INFO;
      const alert = await this.prisma.alert.create({
        data: {
          type,
          severity,
          vehicleId,
          tenantId,
          message,
          data: data as Prisma.InputJsonValue,
          status: AlertStatus.OPEN,
        },
      });

      await this.prisma.alertHistory.create({
        data: {
          alertId: alert.id,
          action: AlertHistoryAction.CREATED,
          metadata: { type, message, severity } as Prisma.InputJsonValue,
        },
      });

      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: { plate: true, brand: true, model: true },
      });

      this.logger.log(`Alerta criado: ${type} (${severity}) — ${message} (vehicle: ${vehicle?.plate})`);

      if (this.emitter) {
        this.emitter(tenantId, {
          id: alert.id,
          type: alert.type,
          severity: alert.severity,
          message: alert.message,
          data: alert.data,
          status: alert.status,
          vehicleId: alert.vehicleId,
          vehicle,
          createdAt: alert.createdAt,
        });
      }

      // Dispatch async — não bloqueia retorno
      this.dispatcher
        .dispatch({
          id: alert.id,
          type: alert.type,
          severity: alert.severity,
          message: alert.message,
          data: alert.data as Record<string, unknown> | null,
          vehicleId: alert.vehicleId,
          tenantId: alert.tenantId,
          createdAt: alert.createdAt,
          vehicle: vehicle ?? undefined,
        })
        .catch((err) => this.logger.error(`Dispatch falhou: ${(err as Error).message}`));

      return alert;
    } catch (error) {
      this.logger.error(`Erro ao criar alerta: ${error}`);
    }
  }

  async notifyOffline(vehicleId: string, tenantId: string, lastUpdate: string | Date) {
    const last = typeof lastUpdate === 'string' ? new Date(lastUpdate) : lastUpdate;
    const minutesAgo = Math.floor((Date.now() - last.getTime()) / 60_000);
    return this.createAlert(
      AlertType.OFFLINE,
      vehicleId,
      tenantId,
      `Rastreador sem comunicação há ${minutesAgo} min`,
      { lastUpdate: last.toISOString(), minutesAgo },
    );
  }

  /**
   * GPS silenciado: rastreador continua mandando heartbeat (status=online no
   * Traccar) mas a última `position` parou de atualizar. Sinal forte de:
   *   - antena GPS arrancada/coberta (roubo em andamento)
   *   - jamming GPS sem disparo de flag de jamming explícita
   *   - veículo em túnel/garagem fechada (falso positivo possível, operador valida)
   * Severidade CRITICAL — não pode mascarar como veículo parado normal.
   */
  async notifyGpsSilent(
    vehicleId: string,
    tenantId: string,
    lastPositionAt: Date,
    lastHeartbeatAt: Date,
  ) {
    const minutesGpsSilent = Math.floor(
      (Date.now() - lastPositionAt.getTime()) / 60_000,
    );
    return this.createAlert(
      AlertType.GPS_SILENT,
      vehicleId,
      tenantId,
      `GPS silenciado há ${minutesGpsSilent} min (heartbeat continua chegando — possível sabotagem da antena)`,
      {
        lastPositionAt: lastPositionAt.toISOString(),
        lastHeartbeatAt: lastHeartbeatAt.toISOString(),
        minutesGpsSilent,
        severity: 'CRITICAL',
      },
    );
  }

  async findAll(tenantId: string, filters: FilterAlertsDto) {
    const { page, perPage, type, status, assignedToId, vehicleId, read, from, to } = filters;

    const where: Prisma.AlertWhereInput = { tenantId };
    if (type) where.type = type;
    if (status) where.status = status;
    if (assignedToId) where.assignedToId = assignedToId;
    if (vehicleId) where.vehicleId = vehicleId;
    if (read !== undefined) where.read = read;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [data, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        include: {
          vehicle: { select: { plate: true, brand: true, model: true, color: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.alert.count({ where }),
    ]);

    return { data, meta: { total, page, perPage } };
  }

  async markAsRead(id: string, tenantId: string) {
    return this.prisma.alert.updateMany({ where: { id, tenantId }, data: { read: true } });
  }

  async markAllAsRead(tenantId: string) {
    return this.prisma.alert.updateMany({ where: { tenantId, read: false }, data: { read: true } });
  }

  async getUnreadCount(tenantId: string) {
    const count = await this.prisma.alert.count({ where: { tenantId, read: false } });
    return { count };
  }

  async assume(id: string, tenantId: string, actor: ActorInfo) {
    const alert = await this.getOrThrow(id, tenantId);
    if (alert.status === AlertStatus.RESOLVED) {
      throw new BadRequestException('Alerta resolvido não pode ser assumido. Reabra antes.');
    }
    const reassigning = alert.assignedToId && alert.assignedToId !== actor.userId;
    const updated = await this.prisma.alert.update({
      where: { id },
      data: { status: AlertStatus.IN_PROGRESS, assignedToId: actor.userId, assignedAt: new Date() },
    });
    await this.prisma.alertHistory.create({
      data: {
        alertId: id,
        userId: actor.userId,
        userEmail: actor.email ?? null,
        action: AlertHistoryAction.ASSIGNED,
        metadata: reassigning
          ? ({ previousAssignedToId: alert.assignedToId } as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
    return updated;
  }

  async resolve(id: string, tenantId: string, resolution: string, actor: ActorInfo) {
    const alert = await this.getOrThrow(id, tenantId);
    if (alert.status === AlertStatus.RESOLVED) {
      throw new BadRequestException('Alerta já está resolvido.');
    }
    const updated = await this.prisma.alert.update({
      where: { id },
      data: {
        status: AlertStatus.RESOLVED,
        resolution,
        resolvedById: actor.userId,
        resolvedAt: new Date(),
        read: true,
      },
    });
    await this.prisma.alertHistory.create({
      data: {
        alertId: id,
        userId: actor.userId,
        userEmail: actor.email ?? null,
        action: AlertHistoryAction.RESOLVED,
        comment: resolution,
      },
    });
    return updated;
  }

  async reopen(id: string, tenantId: string, actor: ActorInfo) {
    const alert = await this.getOrThrow(id, tenantId);
    if (alert.status !== AlertStatus.RESOLVED) {
      throw new BadRequestException('Só é possível reabrir alertas resolvidos.');
    }
    const updated = await this.prisma.alert.update({
      where: { id },
      data: {
        status: AlertStatus.IN_PROGRESS,
        resolvedAt: null,
        resolvedById: null,
        resolution: null,
      },
    });
    await this.prisma.alertHistory.create({
      data: {
        alertId: id,
        userId: actor.userId,
        userEmail: actor.email ?? null,
        action: AlertHistoryAction.REOPENED,
      },
    });
    return updated;
  }

  async comment(id: string, tenantId: string, comment: string, actor: ActorInfo) {
    await this.getOrThrow(id, tenantId);
    return this.prisma.alertHistory.create({
      data: {
        alertId: id,
        userId: actor.userId,
        userEmail: actor.email ?? null,
        action: AlertHistoryAction.COMMENTED,
        comment,
      },
    });
  }

  async getHistory(id: string, tenantId: string) {
    await this.getOrThrow(id, tenantId);
    return this.prisma.alertHistory.findMany({
      where: { alertId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async getOrThrow(id: string, tenantId: string) {
    const alert = await this.prisma.alert.findFirst({ where: { id, tenantId } });
    if (!alert) throw new NotFoundException(`Alerta ${id} não encontrado`);
    return alert;
  }
}
