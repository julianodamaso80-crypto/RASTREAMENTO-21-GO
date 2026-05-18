import { Injectable, Logger } from '@nestjs/common';
import { AlertType, Prisma } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { AlertsService } from '../alerts/alerts.service';
import type {
  TraccarPosition,
  TraccarPositionAttributes,
} from '../traccar/traccar.service';

const STATIONARY_THROTTLE_MS = 60_000;

@Injectable()
export class PositionsService {
  private readonly logger = new Logger(PositionsService.name);
  private lastPersistedByVehicle = new Map<string, { at: number; ignition: boolean | null; speed: number }>();
  private warnedAttrs = new Set<string>();
  private lastFuelByVehicle = new Map<string, { fuel: number; at: number; ignition: boolean | null }>();

  constructor(
    private prisma: PrismaService,
    private settings: TenantSettingsService,
    private alerts: AlertsService,
  ) {}

  /**
   * Decide se uma posição entra no histórico e persiste se sim.
   * Política:
   * - SEMPRE persiste: mudança de ignição, qualquer flag crítica (powerCut, jamming,
   *   vibration, jarring, charging), alarm não-nulo, speed >= 5 km/h.
   * - SE PARADO (speed < 5): throttle de 1/min (basta pra confirmar presença).
   */
  async persistIfRelevant(
    position: TraccarPosition,
    vehicleId: string,
    tenantId: string,
  ): Promise<void> {
    try {
      const attrs = (position.attributes ?? {}) as TraccarPositionAttributes;
      const ignition = typeof attrs.ignition === 'boolean' ? attrs.ignition : null;
      const speedKmh = (position.speed ?? 0) * 1.852;

      const last = this.lastPersistedByVehicle.get(vehicleId);
      const now = Date.now();

      const ignitionChanged = last ? last.ignition !== ignition : true;
      const hasCriticalFlag =
        attrs.powerCut === true ||
        attrs.jamming === true ||
        attrs.vibration === true ||
        attrs.jarring === true ||
        attrs.collision === true ||
        attrs.tamper === true ||
        attrs.sos === true ||
        (typeof attrs.alarm === 'string' && attrs.alarm.length > 0);

      const moving = speedKmh >= 5;
      const throttleElapsed = !last || now - last.at >= STATIONARY_THROTTLE_MS;

      const shouldPersist =
        ignitionChanged || hasCriticalFlag || moving || throttleElapsed;

      if (!shouldPersist) return;

      this.detectUnknownAttributes(attrs, position.protocol);

      await this.prisma.position.create({
        data: {
          vehicleId,
          tenantId,
          traccarPositionId: position.id,
          deviceTime: new Date(position.deviceTime || position.serverTime),
          latitude: position.latitude,
          longitude: position.longitude,
          speed: speedKmh,
          course: position.course ?? null,
          altitude: position.altitude ?? null,
          accuracy: position.accuracy ?? null,
          address: position.address || null,
          ignition,
          batteryLevel: this.numberOrNull(attrs.batteryLevel),
          powerVolts: this.numberOrNull(attrs.power),
          rpm: this.intOrNull(attrs.rpm),
          fuel: this.numberOrNull(attrs.fuel),
          temperature:
            this.numberOrNull(attrs.temperature) ??
            this.numberOrNull(attrs.temp1),
          odometer:
            this.numberOrNull(attrs.odometer) ??
            this.numberOrNull(attrs.totalDistance),
          gsmSignal:
            this.intOrNull(attrs.gsmSignal) ?? this.intOrNull(attrs.rssi),
          satellites:
            this.intOrNull(attrs.satellites) ?? this.intOrNull(attrs.sat),
          powerCut: attrs.powerCut === true,
          jamming: attrs.jamming === true,
          vibration: attrs.vibration === true,
          jarring: attrs.jarring === true || attrs.collision === true,
          charging: attrs.charging === true || attrs.charge === true,
          alarm: typeof attrs.alarm === 'string' ? attrs.alarm : null,
          rawAttributes: attrs as Prisma.InputJsonValue,
        },
      });

      this.lastPersistedByVehicle.set(vehicleId, {
        at: now,
        ignition,
        speed: speedKmh,
      });

      await this.detectFuelTheft(vehicleId, tenantId, attrs, ignition, position);
    } catch (error) {
      this.logger.warn(
        `persistIfRelevant falhou (vehicle ${vehicleId}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Lista posições de um veículo num intervalo. Usado por replay, análise de
   * condução, telemetria, etc.
   */
  async listByVehicle(
    vehicleId: string,
    tenantId: string,
    from: Date,
    to: Date,
    limit = 5000,
  ) {
    return this.prisma.position.findMany({
      where: {
        vehicleId,
        tenantId,
        deviceTime: { gte: from, lte: to },
      },
      orderBy: { deviceTime: 'asc' },
      take: limit,
    });
  }

  async findLatestByVehicle(vehicleId: string, tenantId: string) {
    return this.prisma.position.findFirst({
      where: { vehicleId, tenantId },
      orderBy: { deviceTime: 'desc' },
    });
  }

  async findPreviousByVehicle(
    vehicleId: string,
    tenantId: string,
    beforeTime: Date,
  ) {
    return this.prisma.position.findFirst({
      where: {
        vehicleId,
        tenantId,
        deviceTime: { lt: beforeTime },
      },
      orderBy: { deviceTime: 'desc' },
    });
  }

  /**
   * Detecta queda brusca de combustível com motor desligado (sinal clássico
   * de bombeamento manual). Janela e percentual configuráveis em TenantSettings.
   */
  private async detectFuelTheft(
    vehicleId: string,
    tenantId: string,
    attrs: TraccarPositionAttributes,
    ignition: boolean | null,
    position: TraccarPosition,
  ) {
    const fuelNow = this.numberOrNull(attrs.fuel);
    if (fuelNow === null) return;

    const now = Date.now();
    const last = this.lastFuelByVehicle.get(vehicleId);
    this.lastFuelByVehicle.set(vehicleId, { fuel: fuelNow, at: now, ignition });

    if (!last) return;
    if (ignition === true) return; // só conta drop com ignição off
    if (last.ignition === true) return;

    const settings = await this.settings.getForTenant(tenantId);
    const windowMs = settings.fuelDropWindowMinutes * 60 * 1000;
    if (now - last.at > windowMs) return;

    const dropPct = last.fuel === 0 ? 0 : ((last.fuel - fuelNow) / last.fuel) * 100;
    if (dropPct >= settings.fuelDropPercentForTheft) {
      await this.alerts.createAlert(
        AlertType.FUEL_THEFT,
        vehicleId,
        tenantId,
        `Queda de combustível de ${dropPct.toFixed(1)}% com motor desligado`,
        {
          fuelBefore: last.fuel,
          fuelAfter: fuelNow,
          dropPercent: Math.round(dropPct * 10) / 10,
          latitude: position.latitude,
          longitude: position.longitude,
        },
      );
    }
  }

  private numberOrNull(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.length && !Number.isNaN(Number(v))) {
      return Number(v);
    }
    return null;
  }

  private intOrNull(v: unknown): number | null {
    const n = this.numberOrNull(v);
    return n === null ? null : Math.round(n);
  }

  /**
   * Loga uma única vez por protocolo+atributo desconhecido. Permite descobrir
   * campos novos sem poluir logs.
   */
  private detectUnknownAttributes(
    attrs: TraccarPositionAttributes,
    protocol: string,
  ) {
    const known = new Set([
      'ignition',
      'motion',
      'batteryLevel',
      'power',
      'charge',
      'charging',
      'rpm',
      'fuel',
      'fuelConsumption',
      'temp1',
      'temp2',
      'temperature',
      'odometer',
      'totalDistance',
      'hours',
      'engineHours',
      'sat',
      'satellites',
      'rssi',
      'gsmSignal',
      'hdop',
      'pdop',
      'alarm',
      'alarmType',
      'powerCut',
      'jamming',
      'vibration',
      'jarring',
      'collision',
      'tamper',
      'sos',
      'blocked',
      'door',
      'distance',
      'event',
      'index',
      'priority',
      'archive',
      'valid',
    ]);
    for (const k of Object.keys(attrs)) {
      if (known.has(k) || k.startsWith('io')) continue;
      const key = `${protocol}:${k}`;
      if (!this.warnedAttrs.has(key)) {
        this.warnedAttrs.add(key);
        this.logger.debug(`Atributo desconhecido [${protocol}] -> ${k}`);
      }
    }
  }
}
