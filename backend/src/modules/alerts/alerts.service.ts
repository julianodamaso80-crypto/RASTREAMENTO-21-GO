import { Injectable, Logger } from '@nestjs/common';
import { AlertType, Prisma } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { FilterAlertsDto } from './dto/filter-alerts.dto';
import type { TraccarPosition } from '../traccar/traccar.service';

// Callback para emitir alertas via WebSocket
type AlertEmitter = (tenantId: string, alert: Record<string, unknown>) => void;

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  // Cache do último estado de ignição por deviceId
  private ignitionState = new Map<number, boolean>();
  private emitter: AlertEmitter | null = null;

  // Velocidade máxima em knots (120 km/h ≈ 65 knots)
  private readonly SPEED_LIMIT_KNOTS = 65;

  // Acesso ao model alert (workaround Prisma v7 com adapter)
  private get alertModel() {
    return (this.prisma as any).alert;
  }

  constructor(private prisma: PrismaService) {}

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
        { speed: kmh, latitude: position.latitude, longitude: position.longitude },
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
  }

  private async createAlert(
    type: AlertType,
    vehicleId: string,
    tenantId: string,
    message: string,
    data: Record<string, unknown>,
  ) {
    try {
      const alert = await this.alertModel.create({
        data: { type, vehicleId, tenantId, message, data: data as any },
      });

      // Buscar veículo para log e emissão
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: { plate: true, brand: true, model: true },
      });

      this.logger.log(`Alerta criado: ${type} - ${message} (vehicle: ${vehicle?.plate})`);

      // Emitir via WebSocket
      if (this.emitter) {
        this.emitter(tenantId, {
          id: alert.id,
          type: alert.type,
          message: alert.message,
          data: alert.data,
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

  async findAll(tenantId: string, filters: FilterAlertsDto) {
    const { page, perPage, type, vehicleId, read, from, to } = filters;

    const where: Prisma.AlertWhereInput = { tenantId };
    if (type) where.type = type;
    if (vehicleId) where.vehicleId = vehicleId;
    if (read !== undefined) where.read = read;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [data, total] = await Promise.all([
      this.alertModel.findMany({
        where,
        include: {
          vehicle: { select: { plate: true, brand: true, model: true, color: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.alertModel.count({ where }),
    ]);

    return { data, meta: { total, page, perPage } };
  }

  async markAsRead(id: string, tenantId: string) {
    return this.alertModel.updateMany({
      where: { id, tenantId },
      data: { read: true },
    });
  }

  async markAllAsRead(tenantId: string) {
    return this.alertModel.updateMany({
      where: { tenantId, read: false },
      data: { read: true },
    });
  }

  async getUnreadCount(tenantId: string) {
    const count = await this.alertModel.count({
      where: { tenantId, read: false },
    });
    return { count };
  }
}
