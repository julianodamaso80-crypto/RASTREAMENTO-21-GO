import { Injectable, Logger } from '@nestjs/common';
import type { TenantSettings } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface ResolvedSettings {
  speedThresholdKmh: number;
  offlineThresholdMinutes: number;
  batteryDeviceLowThreshold: number;
  batteryVehicleLowVolts: number;
  harshBrakeKmhPerSec: number;
  harshAccelKmhPerSec: number;
  fuelDropPercentForTheft: number;
  fuelDropWindowMinutes: number;
  engineOverheatCelsius: number;
  idleSpeedKmh: number;
  autoBlockOnPowerCut: boolean;
  jammingConfirmReadings: number;
  notifyChannels: { email: boolean; push: boolean; whatsapp: boolean };
  notifyTypes: Record<string, boolean> | null;
}

const DEFAULTS: ResolvedSettings = {
  speedThresholdKmh: 120,
  offlineThresholdMinutes: 15,
  batteryDeviceLowThreshold: 20,
  batteryVehicleLowVolts: 11.5,
  harshBrakeKmhPerSec: -10,
  harshAccelKmhPerSec: 8,
  fuelDropPercentForTheft: 10,
  fuelDropWindowMinutes: 5,
  engineOverheatCelsius: 100,
  idleSpeedKmh: 2,
  autoBlockOnPowerCut: false,
  jammingConfirmReadings: 2,
  notifyChannels: { email: true, push: true, whatsapp: false },
  notifyTypes: null,
};

interface CacheEntry {
  data: ResolvedSettings;
  expiresAt: number;
}

@Injectable()
export class TenantSettingsService {
  private readonly logger = new Logger(TenantSettingsService.name);
  private cache = new Map<string, CacheEntry>();

  constructor(private prisma: PrismaService) {}

  async getForTenant(tenantId: string): Promise<ResolvedSettings> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const row = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    const resolved = row ? this.fromRow(row) : DEFAULTS;
    this.cache.set(tenantId, {
      data: resolved,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return resolved;
  }

  async upsert(tenantId: string, patch: Partial<ResolvedSettings>) {
    const data = {
      ...this.toRow(patch),
      tenantId,
    };
    const updated = await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: data,
      update: this.toRow(patch),
    });
    this.cache.delete(tenantId);
    return this.fromRow(updated);
  }

  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }

  private fromRow(row: TenantSettings): ResolvedSettings {
    const channels = (row.notifyChannels ?? DEFAULTS.notifyChannels) as ResolvedSettings['notifyChannels'];
    return {
      speedThresholdKmh: row.speedThresholdKmh,
      offlineThresholdMinutes: row.offlineThresholdMinutes,
      batteryDeviceLowThreshold: row.batteryDeviceLowThreshold,
      batteryVehicleLowVolts: row.batteryVehicleLowVolts,
      harshBrakeKmhPerSec: row.harshBrakeKmhPerSec,
      harshAccelKmhPerSec: row.harshAccelKmhPerSec,
      fuelDropPercentForTheft: row.fuelDropPercentForTheft,
      fuelDropWindowMinutes: row.fuelDropWindowMinutes,
      engineOverheatCelsius: row.engineOverheatCelsius,
      idleSpeedKmh: row.idleSpeedKmh,
      autoBlockOnPowerCut: row.autoBlockOnPowerCut,
      jammingConfirmReadings: row.jammingConfirmReadings,
      notifyChannels: {
        email: channels.email ?? true,
        push: channels.push ?? true,
        whatsapp: channels.whatsapp ?? false,
      },
      notifyTypes: (row.notifyTypes as Record<string, boolean> | null) ?? null,
    };
  }

  private toRow(patch: Partial<ResolvedSettings>) {
    const out: Record<string, unknown> = {};
    if (patch.speedThresholdKmh !== undefined) out.speedThresholdKmh = patch.speedThresholdKmh;
    if (patch.offlineThresholdMinutes !== undefined) out.offlineThresholdMinutes = patch.offlineThresholdMinutes;
    if (patch.batteryDeviceLowThreshold !== undefined) out.batteryDeviceLowThreshold = patch.batteryDeviceLowThreshold;
    if (patch.batteryVehicleLowVolts !== undefined) out.batteryVehicleLowVolts = patch.batteryVehicleLowVolts;
    if (patch.harshBrakeKmhPerSec !== undefined) out.harshBrakeKmhPerSec = patch.harshBrakeKmhPerSec;
    if (patch.harshAccelKmhPerSec !== undefined) out.harshAccelKmhPerSec = patch.harshAccelKmhPerSec;
    if (patch.fuelDropPercentForTheft !== undefined) out.fuelDropPercentForTheft = patch.fuelDropPercentForTheft;
    if (patch.fuelDropWindowMinutes !== undefined) out.fuelDropWindowMinutes = patch.fuelDropWindowMinutes;
    if (patch.engineOverheatCelsius !== undefined) out.engineOverheatCelsius = patch.engineOverheatCelsius;
    if (patch.idleSpeedKmh !== undefined) out.idleSpeedKmh = patch.idleSpeedKmh;
    if (patch.autoBlockOnPowerCut !== undefined) out.autoBlockOnPowerCut = patch.autoBlockOnPowerCut;
    if (patch.jammingConfirmReadings !== undefined) out.jammingConfirmReadings = patch.jammingConfirmReadings;
    if (patch.notifyChannels !== undefined) out.notifyChannels = patch.notifyChannels;
    if (patch.notifyTypes !== undefined) out.notifyTypes = patch.notifyTypes;
    return out;
  }
}
