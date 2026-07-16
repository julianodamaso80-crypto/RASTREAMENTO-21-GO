import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  TraccarService,
  TraccarPosition,
} from '../traccar/traccar.service';

const KNOTS_TO_KMH = 1.852;

/** Posição "limpa" pro app — só o que a UI do associado precisa. */
function toPositionDto(p: TraccarPosition) {
  const a = p.attributes ?? {};
  return {
    latitude: p.latitude,
    longitude: p.longitude,
    speed: Math.round(p.speed * KNOTS_TO_KMH), // nós → km/h
    course: p.course,
    address: p.address ?? null,
    fixTime: p.fixTime, // momento REAL do GPS (nunca confundir com heartbeat)
    ignition: a.ignition ?? null,
    motion: a.motion ?? null,
    battery: a.batteryLevel ?? null,
    // Telemetria detalhada (para a ficha do veículo no app)
    voltage: a.power ?? null, // tensão da bateria do veículo (V)
    satellites: a.sat ?? a.satellites ?? null, // nº de satélites GPS
    odometer:
      a.totalDistance != null ? Math.round(a.totalDistance / 1000) : null, // km
    powerCut: a.powerCut ?? null, // alimentação cortada (possível sabotagem)
  };
}

@Injectable()
export class AppDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly traccar: TraccarService,
  ) {}

  /** Veículos do associado + última posição + status de conexão. */
  async getVehicles(associateId: string, tenantId: string) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { associateId, tenantId, deletedAt: null },
      select: {
        id: true,
        plate: true,
        vehicleType: true, // CAR | MOTORCYCLE — define o desenho do marcador no app
        brand: true,
        model: true,
        color: true,
        year: true,
        status: true,
        traccarDeviceId: true,
      },
      orderBy: { plate: 'asc' },
    });

    const deviceIds = vehicles
      .map((v) => v.traccarDeviceId)
      .filter((id): id is number => id !== null);

    if (deviceIds.length === 0) {
      return vehicles.map((v) => ({ ...v, position: null, connection: null }));
    }

    // Posição (GPS real) e device (status de conexão = heartbeat) são fontes
    // distintas e expostas separadamente — ver regra de segurança do projeto.
    const [positions, devices] = await Promise.all([
      this.traccar.getPositions(),
      this.traccar.getDevices(),
    ]);

    const posByDevice = new Map(positions.map((p) => [p.deviceId, p]));
    const devByDevice = new Map(devices.map((d) => [d.id, d]));

    return vehicles.map((v) => {
      const pos = v.traccarDeviceId
        ? posByDevice.get(v.traccarDeviceId)
        : undefined;
      const dev = v.traccarDeviceId
        ? devByDevice.get(v.traccarDeviceId)
        : undefined;
      return {
        ...v,
        position: pos ? toPositionDto(pos) : null,
        connection: dev
          ? { status: dev.status, lastUpdate: dev.lastUpdate }
          : null,
      };
    });
  }

  /** Histórico de posições de um veículo do associado num intervalo. */
  async getHistory(
    associateId: string,
    tenantId: string,
    vehicleId: string,
    from: string,
    to: string,
  ) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, associateId, tenantId, deletedAt: null },
      select: { traccarDeviceId: true },
    });

    if (!vehicle) {
      throw new NotFoundException('Veículo não encontrado');
    }
    if (!vehicle.traccarDeviceId) {
      return [];
    }

    const positions = await this.traccar.getPositions(
      vehicle.traccarDeviceId,
      from,
      to,
    );
    return positions.map(toPositionDto);
  }

  /** Alertas dos veículos do associado, mais recentes primeiro. */
  async getAlerts(associateId: string, tenantId: string, limit = 50) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { associateId, tenantId, deletedAt: null },
      select: { id: true },
    });
    const vehicleIds = vehicles.map((v) => v.id);
    if (vehicleIds.length === 0) return [];

    return this.prisma.alert.findMany({
      where: { vehicleId: { in: vehicleIds }, tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        type: true,
        severity: true,
        message: true,
        status: true,
        read: true,
        createdAt: true,
        vehicle: { select: { id: true, plate: true } },
      },
    });
  }
}
