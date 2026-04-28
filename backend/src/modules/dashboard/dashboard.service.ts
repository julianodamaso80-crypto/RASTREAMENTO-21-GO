import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import { TtlCache } from '../../common/cache/ttl-cache';
import type { DashboardPeriod } from './dto/dashboard-query.dto';

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min sem update = offline
const H1 = 60 * 60 * 1000;
const H24 = 24 * H1;
const D30 = 30 * H24;

const CRITICAL_ALERT_TYPES = ['SOS'] as const;

interface TimeSeriesBucket {
  label: string; // ISO hour ou YYYY-MM-DD
  count: number;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private prisma: PrismaService,
    private traccar: TraccarService,
    private cache: TtlCache,
  ) {}

  async getOverview(tenantId: string, period: DashboardPeriod) {
    const cacheKey = `dashboard:overview:${tenantId}:${period}`;
    const cached = this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const { from, to, bucketBy } = this.periodRange(period, now);
    const ago1h = new Date(now.getTime() - H1);
    const ago24h = new Date(now.getTime() - H24);
    const ago30d = new Date(now.getTime() - D30);

    // Queries paralelas no Postgres — O(1) cada com índices existentes
    const [
      totalVehicles,
      vehiclesPrevMonth,
      devices,
      alertsInPeriod,
      alertsByType24h,
      criticalOpen,
      recentAlerts,
      timeSeriesRaw,
    ] = await Promise.all([
      this.prisma.vehicle.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.vehicle.count({
        where: { tenantId, deletedAt: null, createdAt: { lt: ago30d } },
      }),
      this.prisma.device.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          imei: true,
          traccarDeviceId: true,
          lastConnection: true,
          status: true,
          vehicle: { select: { id: true, plate: true } },
        },
      }),
      this.prisma.alert.count({
        where: { tenantId, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.alert.groupBy({
        by: ['type'],
        where: { tenantId, createdAt: { gte: ago24h } },
        _count: { type: true },
      }),
      this.prisma.alert.count({
        where: {
          tenantId,
          type: { in: CRITICAL_ALERT_TYPES as unknown as any[] },
          read: false,
        },
      }),
      this.prisma.alert.findMany({
        where: { tenantId, createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { vehicle: { select: { id: true, plate: true } } },
      }),
      this.timeSeries(tenantId, from, to, bucketBy),
    ]);

    // KPIs derivados do array de devices (sem N+1 queries)
    const onlineNow = devices.filter(
      (d) =>
        d.lastConnection &&
        now.getTime() - new Date(d.lastConnection).getTime() <
          ONLINE_THRESHOLD_MS,
    ).length;
    const offlineOver1h = devices.filter(
      (d) =>
        !d.lastConnection ||
        now.getTime() - new Date(d.lastConnection).getTime() > H1,
    ).length;
    const noCommOver24h = devices.filter(
      (d) =>
        !d.lastConnection ||
        now.getTime() - new Date(d.lastConnection).getTime() > H24,
    ).length;

    // KM + bateria + top vehicles vêm do Traccar (best-effort, não bloqueia resposta se falhar)
    let kmInPeriod = 0;
    let lowBattery = 0;
    let topKmVehicles: {
      vehicleId: string | null;
      plate: string;
      km: number;
    }[] = [];

    const traccarIds = devices
      .map((d) => d.traccarDeviceId)
      .filter((id): id is number => typeof id === 'number');

    try {
      const [positions, summary] = await Promise.all([
        this.traccar.getPositions().catch(() => []),
        this.traccar
          .getReportSummary(traccarIds, from.toISOString(), to.toISOString())
          .catch(() => []),
      ]);

      // Multi-tenant: só conta posições de devices DESTE tenant (getPositions retorna global)
      const tenantTraccarIdSet = new Set(traccarIds);
      for (const pos of positions) {
        if (!tenantTraccarIdSet.has(pos.deviceId)) continue;
        const bat = (pos.attributes as Record<string, unknown> | undefined)
          ?.batteryLevel;
        if (typeof bat === 'number' && bat < 20) lowBattery++;
      }

      const deviceByTraccarId = new Map(
        devices.map((d) => [d.traccarDeviceId, d]),
      );
      const distancesByVehicle: {
        plate: string;
        vehicleId: string | null;
        km: number;
      }[] = [];
      for (const row of summary) {
        const km = (row.distance || 0) / 1000;
        kmInPeriod += km;
        const device = deviceByTraccarId.get(row.deviceId);
        if (device?.vehicle) {
          distancesByVehicle.push({
            plate: device.vehicle.plate,
            vehicleId: device.vehicle.id,
            km: Math.round(km * 10) / 10,
          });
        }
      }
      topKmVehicles = distancesByVehicle
        .sort((a, b) => b.km - a.km)
        .slice(0, 10);
    } catch (err) {
      this.logger.warn(
        `Traccar indisponível para KPIs de km/bateria: ${String(err)}`,
      );
    }

    // Breakdown de alertas nas últimas 24h por tipo
    const alertsByType = Object.fromEntries(
      alertsByType24h.map((row) => [row.type, row._count.type]),
    );
    const totalAlerts24h = alertsByType24h.reduce(
      (acc, row) => acc + row._count.type,
      0,
    );

    // Veículos que precisam atenção — ordena por mais antigo primeiro (sem comunicação > offline >1h)
    const needsAttention = devices
      .filter((d) => {
        if (!d.vehicle) return false;
        if (!d.lastConnection) return true;
        const ageMs = now.getTime() - new Date(d.lastConnection).getTime();
        return ageMs > H1;
      })
      .sort((a, b) => {
        const ta = a.lastConnection ? new Date(a.lastConnection).getTime() : 0;
        const tb = b.lastConnection ? new Date(b.lastConnection).getTime() : 0;
        return ta - tb; // mais antigo primeiro; sem lastConnection vai pro topo (ts=0)
      })
      .slice(0, 10)
      .map((d) => {
        const ageMs = d.lastConnection
          ? now.getTime() - new Date(d.lastConnection).getTime()
          : Infinity;
        const reason =
          ageMs === Infinity
            ? 'Sem comunicação'
            : ageMs > H24
              ? 'Sem comunicação >24h'
              : 'Offline >1h';
        return {
          vehicleId: d.vehicle!.id,
          plate: d.vehicle!.plate,
          reason,
          lastSeen: d.lastConnection?.toISOString() ?? null,
        };
      });

    const diffMonth =
      vehiclesPrevMonth > 0 ? totalVehicles - vehiclesPrevMonth : null;
    const percentOnline =
      totalVehicles > 0 ? Math.round((onlineNow / totalVehicles) * 100) : 0;

    // Fleet status pra pizza
    const fleetStatus = {
      online: onlineNow,
      offline: Math.max(devices.length - onlineNow, 0),
      alerta: totalAlerts24h > 0 ? Math.min(totalAlerts24h, devices.length) : 0,
    };

    const response = {
      period,
      generatedAt: now.toISOString(),
      kpis: {
        totalVehicles: { value: totalVehicles, diffMonth },
        onlineNow: { value: onlineNow, percentOfTotal: percentOnline },
        offlineOver1h: { value: offlineOver1h },
        alerts24h: { value: totalAlerts24h, byType: alertsByType },
        kmInPeriod: { value: Math.round(kmInPeriod * 10) / 10 },
        criticalOpen: { value: criticalOpen },
        lowBattery: { value: lowBattery },
        noCommOver24h: { value: noCommOver24h },
      },
      charts: {
        alertsTimeSeries: timeSeriesRaw,
        fleetStatus,
        topKmVehicles,
      },
      tables: {
        recentEvents: recentAlerts.map((a) => ({
          id: a.id,
          type: a.type,
          message: a.message,
          vehicleId: a.vehicleId,
          plate: a.vehicle?.plate ?? null,
          createdAt: a.createdAt.toISOString(),
        })),
        needsAttention,
      },
      meta: {
        alertsInPeriod,
        deviceCount: devices.length,
      },
    };

    this.cache.set(cacheKey, response, 60);
    return response;
  }

  private periodRange(
    period: DashboardPeriod,
    now: Date,
  ): { from: Date; to: Date; bucketBy: 'hour' | 'day' } {
    const to = now;
    if (period === 'today') {
      const from = new Date(now);
      from.setHours(0, 0, 0, 0);
      return { from, to, bucketBy: 'hour' };
    }
    if (period === '7d') {
      const from = new Date(now.getTime() - 7 * H24);
      return { from, to, bucketBy: 'day' };
    }
    const from = new Date(now.getTime() - 30 * H24);
    return { from, to, bucketBy: 'day' };
  }

  // Agrupa alerts por hora/dia via SQL (Postgres date_trunc)
  private async timeSeries(
    tenantId: string,
    from: Date,
    to: Date,
    bucketBy: 'hour' | 'day',
  ): Promise<TimeSeriesBucket[]> {
    const trunc = bucketBy === 'hour' ? 'hour' : 'day';
    const rows = await this.prisma.$queryRawUnsafe<
      { bucket: Date; count: bigint }[]
    >(
      `SELECT date_trunc('${trunc}', created_at) AS bucket, COUNT(*)::bigint AS count
       FROM alerts
       WHERE tenant_id = $1::uuid AND created_at >= $2 AND created_at <= $3
       GROUP BY bucket
       ORDER BY bucket ASC`,
      tenantId,
      from,
      to,
    );
    return rows.map((r) => ({
      label: r.bucket.toISOString(),
      count: Number(r.count),
    }));
  }
}
