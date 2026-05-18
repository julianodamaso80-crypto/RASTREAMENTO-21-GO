import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertType, Prisma } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import { PositionsService } from '../positions/positions.service';

export type BehaviorPeriod = '24h' | '7d' | '30d';

export interface BehaviorReport {
  period: BehaviorPeriod;
  from: string;
  to: string;
  ignitionCycles: number;
  engineMinutes: number;
  idleMinutes: number;
  drivingMinutes: number;
  distanceKm: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  speedExcessCount: number;
  harshBrakeCount: number;
  harshAccelCount: number;
  nightDriveKm: number;
  hourlyHeatmap: number[][];
}

const PERIOD_MS: Record<BehaviorPeriod, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

@Injectable()
export class VehiclesAnalyticsService {
  constructor(
    private prisma: PrismaService,
    private traccar: TraccarService,
    private positions: PositionsService,
  ) {}

  async getTelemetry(
    vehicleId: string,
    tenantId: string,
    period: BehaviorPeriod = '24h',
  ) {
    const exists = await this.prisma.vehicle.count({
      where: { id: vehicleId, tenantId, deletedAt: null },
    });
    if (!exists) throw new NotFoundException('Veículo não encontrado');

    const to = new Date();
    const from = new Date(to.getTime() - PERIOD_MS[period]);

    const positions = await this.prisma.position.findMany({
      where: {
        vehicleId,
        tenantId,
        deviceTime: { gte: from, lte: to },
      },
      select: {
        deviceTime: true,
        speed: true,
        rpm: true,
        fuel: true,
        temperature: true,
        powerVolts: true,
      },
      orderBy: { deviceTime: 'asc' },
      take: 20_000,
    });

    return positions.map((p) => ({
      deviceTime: p.deviceTime.toISOString(),
      speed: p.speed,
      rpm: p.rpm,
      fuel: p.fuel,
      temperature: p.temperature,
      powerVolts: p.powerVolts,
    }));
  }

  /**
   * Lista posições + eventos pra replay. Eventos = alerts no intervalo, georreferenciados
   * quando possível.
   */
  async getReplay(vehicleId: string, tenantId: string, from: Date, to: Date) {
    const exists = await this.prisma.vehicle.count({
      where: { id: vehicleId, tenantId, deletedAt: null },
    });
    if (!exists) throw new NotFoundException('Veículo não encontrado');

    const [positions, alerts] = await Promise.all([
      this.prisma.position.findMany({
        where: { vehicleId, tenantId, deviceTime: { gte: from, lte: to } },
        select: {
          deviceTime: true,
          latitude: true,
          longitude: true,
          speed: true,
          course: true,
          ignition: true,
        },
        orderBy: { deviceTime: 'asc' },
        take: 20_000,
      }),
      this.prisma.alert.findMany({
        where: { vehicleId, tenantId, createdAt: { gte: from, lte: to }, deletedAt: null },
        select: { type: true, message: true, createdAt: true, data: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      positions: positions.map((p) => ({
        deviceTime: p.deviceTime.toISOString(),
        latitude: p.latitude,
        longitude: p.longitude,
        speed: p.speed,
        course: p.course,
        ignition: p.ignition,
      })),
      events: alerts.map((a) => {
        const d = (a.data ?? {}) as { latitude?: number; longitude?: number };
        return {
          type: a.type,
          message: a.message,
          createdAt: a.createdAt.toISOString(),
          latitude: typeof d.latitude === 'number' ? d.latitude : null,
          longitude: typeof d.longitude === 'number' ? d.longitude : null,
        };
      }),
    };
  }

  async getBehavior(
    vehicleId: string,
    tenantId: string,
    period: BehaviorPeriod = '7d',
  ): Promise<BehaviorReport> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId, deletedAt: null },
      select: { id: true, traccarDeviceId: true },
    });
    if (!vehicle) throw new NotFoundException('Veículo não encontrado');

    const to = new Date();
    const from = new Date(to.getTime() - PERIOD_MS[period]);

    const [alerts, positions, traccarSummary] = await Promise.all([
      this.fetchAlerts(vehicleId, tenantId, from, to),
      this.positions.listByVehicle(vehicleId, tenantId, from, to, 50_000),
      this.fetchTraccarSummary(vehicle.traccarDeviceId, from, to),
    ]);

    const ignitionCycles = alerts.filter((a) => a.type === AlertType.IGNITION_ON).length;
    const speedExcessCount = alerts.filter((a) => a.type === AlertType.SPEED).length;
    const harshBrakeCount = alerts.filter((a) => a.type === AlertType.HARSH_BRAKE).length;
    const harshAccelCount = alerts.filter((a) => a.type === AlertType.HARSH_ACCEL).length;

    const { engineMinutes, idleMinutes, drivingMinutes } = this.computeEngineWindows(alerts, positions);
    const { maxSpeedKmh, avgSpeedKmh, nightDriveKm } = this.computeSpeedAndNight(positions);
    const hourlyHeatmap = this.computeHourlyHeatmap(positions);

    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      ignitionCycles,
      engineMinutes,
      idleMinutes,
      drivingMinutes,
      distanceKm: traccarSummary ? traccarSummary.distance / 1000 : 0,
      maxSpeedKmh,
      avgSpeedKmh,
      speedExcessCount,
      harshBrakeCount,
      harshAccelCount,
      nightDriveKm,
      hourlyHeatmap,
    };
  }

  private async fetchAlerts(vehicleId: string, tenantId: string, from: Date, to: Date) {
    return this.prisma.alert.findMany({
      where: {
        vehicleId,
        tenantId,
        createdAt: { gte: from, lte: to },
        deletedAt: null,
      },
      select: { type: true, createdAt: true, data: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async fetchTraccarSummary(traccarDeviceId: number | null, from: Date, to: Date) {
    if (!traccarDeviceId) return null;
    try {
      const list = await this.traccar.getReportSummary([traccarDeviceId], from.toISOString(), to.toISOString());
      return list?.[0] ?? null;
    } catch {
      return null;
    }
  }

  private computeEngineWindows(
    alerts: Array<{ type: AlertType; createdAt: Date }>,
    positions: Array<{ deviceTime: Date; speed: number; ignition: boolean | null }>,
  ) {
    let engineMs = 0;
    let lastOn: number | null = null;
    for (const a of alerts) {
      if (a.type === AlertType.IGNITION_ON) lastOn = a.createdAt.getTime();
      if (a.type === AlertType.IGNITION_OFF && lastOn !== null) {
        engineMs += a.createdAt.getTime() - lastOn;
        lastOn = null;
      }
    }

    // Idle: posições com ignition=true e speed < 5 km/h, somando intervalos
    let idleMs = 0;
    let drivingMs = 0;
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const cur = positions[i];
      if (prev.ignition !== true) continue;
      const dt = cur.deviceTime.getTime() - prev.deviceTime.getTime();
      if (dt <= 0 || dt > 5 * 60 * 1000) continue;
      if (prev.speed < 5) idleMs += dt;
      else drivingMs += dt;
    }

    return {
      engineMinutes: Math.round(engineMs / 60_000),
      idleMinutes: Math.round(idleMs / 60_000),
      drivingMinutes: Math.round(drivingMs / 60_000),
    };
  }

  private computeSpeedAndNight(positions: Array<{ deviceTime: Date; speed: number; latitude: number; longitude: number }>) {
    let maxSpeed = 0;
    let speedSum = 0;
    let speedSamples = 0;
    let nightKm = 0;

    for (let i = 1; i < positions.length; i++) {
      const cur = positions[i];
      const prev = positions[i - 1];
      if (cur.speed > maxSpeed) maxSpeed = cur.speed;
      if (cur.speed > 0) {
        speedSum += cur.speed;
        speedSamples += 1;
      }
      const hour = cur.deviceTime.getUTCHours();
      const isNight = hour >= 22 || hour < 5;
      if (isNight) {
        nightKm += this.haversineKm(prev.latitude, prev.longitude, cur.latitude, cur.longitude);
      }
    }

    return {
      maxSpeedKmh: Math.round(maxSpeed),
      avgSpeedKmh: speedSamples > 0 ? Math.round(speedSum / speedSamples) : 0,
      nightDriveKm: Math.round(nightKm * 10) / 10,
    };
  }

  /**
   * Mapa 7×24 (dia da semana × hora) com contagem de minutos com ignition=true.
   * Útil pra heatmap "perfil de uso" do veículo.
   */
  private computeHourlyHeatmap(positions: Array<{ deviceTime: Date; ignition: boolean | null }>): number[][] {
    const map: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const cur = positions[i];
      if (prev.ignition !== true) continue;
      const dt = cur.deviceTime.getTime() - prev.deviceTime.getTime();
      if (dt <= 0 || dt > 5 * 60 * 1000) continue;
      const day = prev.deviceTime.getDay();
      const hour = prev.deviceTime.getHours();
      map[day][hour] += dt / 60_000;
    }
    // Arredonda
    return map.map((row) => row.map((v) => Math.round(v)));
  }

  private haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
}
