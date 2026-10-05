import { AlertType } from '.prisma/client';
import { AlertsCron } from './alerts.cron';
import type { PrismaService } from '../prisma/prisma.service';
import type { TraccarService } from '../traccar/traccar.service';
import type { AlertsService } from './alerts.service';
import type { TenantSettingsService } from '../tenant-settings/tenant-settings.service';

/**
 * O dedup dos detectores é UMA consulta por rodada. Antes era um `findFirst`
 * por veículo offline: ~1.400 consultas por minuto só para perguntar "já
 * avisei?" (05/10/2026).
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const MIN = 60 * 1000;

function montar(opts: { veiculos: Array<{ id: string; deviceId: number }>; comAlerta: string[]; lastUpdateMin: number }) {
  const agora = Date.now();
  const prisma = {
    vehicle: {
      findMany: jest.fn().mockResolvedValue(
        opts.veiculos.map((v) => ({
          id: v.id,
          traccarDeviceId: v.deviceId,
          tenantId: TENANT,
          plate: `PLACA${v.id}`,
        })),
      ),
    },
    alert: {
      findMany: jest.fn().mockResolvedValue(opts.comAlerta.map((vehicleId) => ({ vehicleId }))),
      findFirst: jest.fn(),
    },
  };
  const traccar = {
    getDevices: jest.fn().mockResolvedValue(
      opts.veiculos.map((v) => ({
        id: v.deviceId,
        status: 'offline',
        lastUpdate: new Date(agora - opts.lastUpdateMin * MIN).toISOString(),
      })),
    ),
    getPositions: jest.fn().mockResolvedValue([]),
  };
  const alerts = {
    notifyOffline: jest.fn().mockResolvedValue(undefined),
    notifyGpsSilent: jest.fn().mockResolvedValue(undefined),
  };
  const settings = {
    getForTenant: jest.fn().mockResolvedValue({ offlineThresholdMinutes: 15 }),
  };
  const cron = new AlertsCron(
    prisma as unknown as PrismaService,
    traccar as unknown as TraccarService,
    alerts as unknown as AlertsService,
    settings as unknown as TenantSettingsService,
  );
  return { cron, prisma, alerts };
}

describe('AlertsCron.detectOffline', () => {
  it('pergunta uma vez só quem já tem alerta recente e pula esses veículos', async () => {
    const { cron, prisma, alerts } = montar({
      veiculos: [
        { id: 'v1', deviceId: 1 },
        { id: 'v2', deviceId: 2 },
        { id: 'v3', deviceId: 3 },
      ],
      comAlerta: ['v2'],
      lastUpdateMin: 40,
    });

    await cron.detectOffline();

    expect(prisma.alert.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: AlertType.OFFLINE }),
      }),
    );
    expect(prisma.alert.findFirst).not.toHaveBeenCalled();
    expect(alerts.notifyOffline).toHaveBeenCalledTimes(2);
    expect(alerts.notifyOffline.mock.calls.map((c) => c[0]).sort()).toEqual(['v1', 'v3']);
  });

  it('não alerta quem comunicou dentro do limite', async () => {
    const { cron, alerts } = montar({
      veiculos: [{ id: 'v1', deviceId: 1 }],
      comAlerta: [],
      lastUpdateMin: 5,
    });

    await cron.detectOffline();

    expect(alerts.notifyOffline).not.toHaveBeenCalled();
  });
});
