import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AlertType, Prisma } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ScoreBreakdown {
  speed: number;
  harshBrake: number;
  harshAccel: number;
  idle: number;
  night: number;
  consistency: number;
}

/**
 * Score do veículo (0-100, maior é melhor).
 * Janela: últimos 30 dias rolling.
 * Componentes: velocidade, frenagem, aceleração, idle, noturno, consistência.
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  // Pesos somam 100
  private readonly WEIGHTS = {
    speed: 40,
    harshBrake: 20,
    harshAccel: 15,
    idle: 10,
    night: 5,
    consistency: 10,
  };

  constructor(private prisma: PrismaService) {}

  async getLatest(vehicleId: string, tenantId: string) {
    const exists = await this.prisma.vehicle.count({
      where: { id: vehicleId, tenantId, deletedAt: null },
    });
    if (!exists) throw new NotFoundException('Veículo não encontrado');

    const latest = await this.prisma.vehicleScore.findFirst({
      where: { vehicleId, tenantId },
      orderBy: { periodEnd: 'desc' },
    });
    if (latest) return this.shape(latest);

    // Não tem score persistido — calcular ao vivo
    return this.computeAndStore(vehicleId, tenantId);
  }

  async ranking(tenantId: string, limit = 100) {
    const scores = await this.prisma.vehicleScore.findMany({
      where: { tenantId },
      orderBy: { periodEnd: 'desc' },
      take: limit * 2,
      include: {
        vehicle: { select: { id: true, plate: true, brand: true, model: true } },
      },
    });

    // Pega o mais recente por veículo
    const byVehicle = new Map<string, (typeof scores)[number]>();
    for (const s of scores) {
      if (!byVehicle.has(s.vehicleId)) byVehicle.set(s.vehicleId, s);
    }

    return [...byVehicle.values()]
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, limit)
      .map((s) => ({
        vehicleId: s.vehicleId,
        plate: s.vehicle.plate,
        brand: s.vehicle.brand,
        model: s.vehicle.model,
        totalScore: s.totalScore,
        kmAnalyzed: s.kmAnalyzed,
        breakdown: s.breakdown as unknown as ScoreBreakdown,
      }));
  }

  async recomputeAll() {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true, tenantId: true },
    });
    this.logger.log(`Recomputando score de ${vehicles.length} veículos...`);
    for (const v of vehicles) {
      try {
        await this.computeAndStore(v.id, v.tenantId);
      } catch (err) {
        this.logger.warn(`Score ${v.id} falhou: ${(err as Error).message}`);
      }
    }
  }

  async computeAndStore(vehicleId: string, tenantId: string) {
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [alerts, positions] = await Promise.all([
      this.prisma.alert.findMany({
        where: {
          vehicleId,
          tenantId,
          createdAt: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          type: {
            in: [AlertType.SPEED, AlertType.HARSH_BRAKE, AlertType.HARSH_ACCEL],
          },
        },
        select: { type: true, createdAt: true },
      }),
      this.prisma.position.findMany({
        where: {
          vehicleId,
          tenantId,
          deviceTime: { gte: periodStart, lte: periodEnd },
        },
        select: { deviceTime: true, speed: true, ignition: true, latitude: true, longitude: true },
        orderBy: { deviceTime: 'asc' },
        take: 50_000,
      }),
    ]);

    const { kmTotal, kmNight, engineMinutes, idleMinutes, activeDays } = this.summarize(positions);
    const breakdown = this.computeBreakdown({
      kmTotal,
      kmNight,
      idleMinutes,
      engineMinutes,
      activeDays,
      speedCount: alerts.filter((a) => a.type === AlertType.SPEED).length,
      brakeCount: alerts.filter((a) => a.type === AlertType.HARSH_BRAKE).length,
      accelCount: alerts.filter((a) => a.type === AlertType.HARSH_ACCEL).length,
    });

    const totalScore = Math.round(
      breakdown.speed * (this.WEIGHTS.speed / 100) +
        breakdown.harshBrake * (this.WEIGHTS.harshBrake / 100) +
        breakdown.harshAccel * (this.WEIGHTS.harshAccel / 100) +
        breakdown.idle * (this.WEIGHTS.idle / 100) +
        breakdown.night * (this.WEIGHTS.night / 100) +
        breakdown.consistency * (this.WEIGHTS.consistency / 100),
    );

    const stored = await this.prisma.vehicleScore.upsert({
      where: {
        vehicleId_periodEnd: { vehicleId, periodEnd: this.dayBucket(periodEnd) },
      },
      create: {
        vehicleId,
        tenantId,
        periodStart,
        periodEnd: this.dayBucket(periodEnd),
        totalScore,
        kmAnalyzed: kmTotal,
        breakdown: breakdown as unknown as Prisma.InputJsonValue,
      },
      update: {
        totalScore,
        kmAnalyzed: kmTotal,
        breakdown: breakdown as unknown as Prisma.InputJsonValue,
      },
    });

    return this.shape(stored);
  }

  /**
   * Cada componente é 0-100. Score zero quando excessivo, 100 quando ideal.
   */
  private computeBreakdown(input: {
    kmTotal: number;
    kmNight: number;
    idleMinutes: number;
    engineMinutes: number;
    activeDays: number;
    speedCount: number;
    brakeCount: number;
    accelCount: number;
  }): ScoreBreakdown {
    const km100 = Math.max(input.kmTotal / 100, 1);

    const speedRate = input.speedCount / km100;
    const speed = this.clamp(100 - speedRate * 25, 0, 100);

    const brakeRate = input.brakeCount / km100;
    const harshBrake = this.clamp(100 - brakeRate * 20, 0, 100);

    const accelRate = input.accelCount / km100;
    const harshAccel = this.clamp(100 - accelRate * 20, 0, 100);

    const idlePct = input.engineMinutes > 0 ? input.idleMinutes / input.engineMinutes : 0;
    const idle = this.clamp(100 - idlePct * 200, 0, 100);

    const nightPct = input.kmTotal > 0 ? input.kmNight / input.kmTotal : 0;
    const night = this.clamp(100 - nightPct * 150, 0, 100);

    const consistency = this.clamp((input.activeDays / 30) * 100, 0, 100);

    return {
      speed: Math.round(speed),
      harshBrake: Math.round(harshBrake),
      harshAccel: Math.round(harshAccel),
      idle: Math.round(idle),
      night: Math.round(night),
      consistency: Math.round(consistency),
    };
  }

  private summarize(
    positions: Array<{ deviceTime: Date; speed: number; ignition: boolean | null; latitude: number; longitude: number }>,
  ) {
    let kmTotal = 0;
    let kmNight = 0;
    let engineMinutes = 0;
    let idleMinutes = 0;
    const days = new Set<string>();

    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const cur = positions[i];
      const dt = cur.deviceTime.getTime() - prev.deviceTime.getTime();
      if (dt <= 0 || dt > 5 * 60 * 1000) continue;

      const distKm = this.haversineKm(prev.latitude, prev.longitude, cur.latitude, cur.longitude);
      kmTotal += distKm;
      const h = prev.deviceTime.getHours();
      if (h >= 22 || h < 5) kmNight += distKm;

      if (prev.ignition === true) {
        engineMinutes += dt / 60_000;
        if (prev.speed < 5) idleMinutes += dt / 60_000;
        days.add(prev.deviceTime.toISOString().slice(0, 10));
      }
    }

    return {
      kmTotal: Math.round(kmTotal * 10) / 10,
      kmNight: Math.round(kmNight * 10) / 10,
      engineMinutes: Math.round(engineMinutes),
      idleMinutes: Math.round(idleMinutes),
      activeDays: days.size,
    };
  }

  private shape(row: {
    vehicleId: string;
    tenantId: string;
    periodStart: Date;
    periodEnd: Date;
    totalScore: number;
    kmAnalyzed: number;
    breakdown: unknown;
  }) {
    return {
      vehicleId: row.vehicleId,
      periodDays: 30,
      totalScore: row.totalScore,
      kmAnalyzed: row.kmAnalyzed,
      breakdown: row.breakdown as ScoreBreakdown,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
    };
  }

  private dayBucket(d: Date) {
    const out = new Date(d);
    out.setUTCHours(0, 0, 0, 0);
    return out;
  }

  private clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
  }

  private haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
}
