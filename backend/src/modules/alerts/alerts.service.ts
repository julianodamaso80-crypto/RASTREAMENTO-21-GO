import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertHistoryAction,
  AlertStatus,
  AlertType,
  Prisma,
} from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GeofencesService } from '../geofences/geofences.service';
import type { FilterAlertsDto } from './dto/filter-alerts.dto';
import type { TraccarPosition } from '../traccar/traccar.service';

// Callback para emitir alertas via WebSocket
type AlertEmitter = (tenantId: string, alert: Record<string, unknown>) => void;

interface ActorInfo {
  userId: string;
  email?: string | null;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  // Cache do último estado de ignição por deviceId
  private ignitionState = new Map<number, boolean>();
  // Cache de geofences que o veículo está dentro (deviceId -> Set<geofenceId>)
  private geofenceState = new Map<number, Set<string>>();
  private emitter: AlertEmitter | null = null;

  // Velocidade máxima em knots (120 km/h ≈ 65 knots)
  private readonly SPEED_LIMIT_KNOTS = 65;

  constructor(
    private prisma: PrismaService,
    private geofencesService: GeofencesService,
  ) {}

  setEmitter(emitter: AlertEmitter) {
    this.emitter = emitter;
  }

  async processPosition(
    position: TraccarPosition,
    vehicleId: string,
    tenantId: string,
  ) {
    const speed = position.speed;
    const ignition = (position.attributes?.ignition as boolean) ?? null;

    // Regra: excesso de velocidade
    if (speed > this.SPEED_LIMIT_KNOTS) {
      const kmh = Math.round(speed * 1.852);
      await this.createAlert(
        AlertType.SPEED,
        vehicleId,
        tenantId,
        `Velocidade de ${kmh} km/h detectada`,
        {
          speed: kmh,
          latitude: position.latitude,
          longitude: position.longitude,
        },
      );
    }

    // Regras: ignição
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

    // Regras: geofencing
    await this.checkGeofences(position, vehicleId, tenantId);
  }

  private async checkGeofences(
    position: TraccarPosition,
    vehicleId: string,
    tenantId: string,
  ) {
    try {
      const geofences = await this.geofencesService.getVehicleGeofences(
        vehicleId,
        tenantId,
      );
      if (geofences.length === 0) return;

      const previousInside =
        this.geofenceState.get(position.deviceId) || new Set<string>();
      const currentInside = new Set<string>();

      for (const geofence of geofences) {
        const inside = this.geofencesService.isPointInGeofence(
          position.latitude,
          position.longitude,
          geofence,
        );

        if (inside) currentInside.add(geofence.id);

        // Entrou na cerca
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

        // Saiu da cerca
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

  private async createAlert(
    type: AlertType,
    vehicleId: string,
    tenantId: string,
    message: string,
    data: Record<string, unknown>,
  ) {
    try {
      const alert = await this.prisma.alert.create({
        data: {
          type,
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
          metadata: { type, message } as Prisma.InputJsonValue,
        },
      });

      // Buscar veículo para log e emissão
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: { plate: true, brand: true, model: true },
      });

      this.logger.log(
        `Alerta criado: ${type} - ${message} (vehicle: ${vehicle?.plate})`,
      );

      // Emitir via WebSocket
      if (this.emitter) {
        this.emitter(tenantId, {
          id: alert.id,
          type: alert.type,
          message: alert.message,
          data: alert.data,
          status: alert.status,
          vehicleId: alert.vehicleId,
          vehicle,
          createdAt: alert.createdAt,
        });
      }

      return alert;
    } catch (error) {
      this.logger.error(`Erro ao criar alerta: ${error}`);
    }
  }

  /**
   * Cria alerta `OFFLINE` para um veículo que parou de comunicar.
   * Chamado pelo `AlertsCron` periodicamente. Idempotência (evitar
   * spam de alertas seguidos) é responsabilidade do caller — esse
   * método só cria.
   */
  async notifyOffline(
    vehicleId: string,
    tenantId: string,
    lastUpdate: string | Date,
  ) {
    const last =
      typeof lastUpdate === 'string'
        ? new Date(lastUpdate)
        : lastUpdate;
    const minutesAgo = Math.floor(
      (Date.now() - last.getTime()) / 60_000,
    );
    return this.createAlert(
      AlertType.OFFLINE,
      vehicleId,
      tenantId,
      `Rastreador sem comunicação há ${minutesAgo} min`,
      { lastUpdate: last.toISOString(), minutesAgo },
    );
  }

  async findAll(tenantId: string, filters: FilterAlertsDto) {
    const {
      page,
      perPage,
      type,
      status,
      assignedToId,
      vehicleId,
      read,
      from,
      to,
    } = filters;

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
          vehicle: {
            select: { plate: true, brand: true, model: true, color: true },
          },
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
    return this.prisma.alert.updateMany({
      where: { id, tenantId },
      data: { read: true },
    });
  }

  async markAllAsRead(tenantId: string) {
    return this.prisma.alert.updateMany({
      where: { tenantId, read: false },
      data: { read: true },
    });
  }

  async getUnreadCount(tenantId: string) {
    const count = await this.prisma.alert.count({
      where: { tenantId, read: false },
    });
    return { count };
  }

  // ─────────────────────────────────────────────────────────────────
  // Workflow: assume / resolve / reopen / comment / history
  // ─────────────────────────────────────────────────────────────────

  async assume(id: string, tenantId: string, actor: ActorInfo) {
    const alert = await this.getOrThrow(id, tenantId);
    if (alert.status === AlertStatus.RESOLVED) {
      throw new BadRequestException(
        'Alerta resolvido não pode ser assumido. Reabra antes.',
      );
    }

    const reassigning =
      alert.assignedToId && alert.assignedToId !== actor.userId;

    const updated = await this.prisma.alert.update({
      where: { id },
      data: {
        status: AlertStatus.IN_PROGRESS,
        assignedToId: actor.userId,
        assignedAt: new Date(),
      },
    });

    await this.prisma.alertHistory.create({
      data: {
        alertId: id,
        userId: actor.userId,
        userEmail: actor.email ?? null,
        action: AlertHistoryAction.ASSIGNED,
        metadata: reassigning
          ? ({
              previousAssignedToId: alert.assignedToId,
            } as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });

    return updated;
  }

  async resolve(
    id: string,
    tenantId: string,
    resolution: string,
    actor: ActorInfo,
  ) {
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
      throw new BadRequestException(
        'Só é possível reabrir alertas resolvidos.',
      );
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

  async comment(
    id: string,
    tenantId: string,
    comment: string,
    actor: ActorInfo,
  ) {
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
    const alert = await this.prisma.alert.findFirst({
      where: { id, tenantId },
    });
    if (!alert) throw new NotFoundException(`Alerta ${id} não encontrado`);
    return alert;
  }
}
