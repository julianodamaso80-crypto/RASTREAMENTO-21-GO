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
        where: expect.objectContaining({
          type: AlertType.OFFLINE,
          tenantId: { in: [TENANT] },
        }),
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

/**
 * ALERTS_DEDUP_EPISODIO=1: um alerta OFFLINE/GPS_SILENT por episódio. O
 * episódio começa no último contato (lastUpdate) ou no último fix válido; se o
 * último alerta do tipo é mais novo que isso, o veículo não voltou desde então.
 */
type VeiculoEp = {
  id: string;
  deviceId: number;
  /** minutos atrás do último contato (OFFLINE) */
  contatoMin: number;
  /** minutos atrás do último fix (GPS_SILENT); heartbeat fica fresco */
  fixMin?: number;
  /** minutos atrás do último alerta do tipo; ausente = nunca alertado */
  ultimoAlertaMin?: number;
};

function montarEpisodio(veiculos: VeiculoEp[]) {
  const agora = Date.now();
  const prisma = {
    vehicle: {
      findMany: jest.fn().mockResolvedValue(
        veiculos.map((v) => ({ id: v.id, traccarDeviceId: v.deviceId, tenantId: TENANT, plate: `P${v.id}` })),
      ),
    },
    alert: { findMany: jest.fn(), findFirst: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue(
      veiculos
        .filter((v) => v.ultimoAlertaMin !== undefined)
        .map((v) => ({ vehicle_id: v.id, created_at: new Date(agora - (v.ultimoAlertaMin as number) * MIN) })),
    ),
  };
  const traccar = {
    getDevices: jest.fn().mockResolvedValue(
      veiculos.map((v) => ({
        id: v.deviceId,
        status: v.contatoMin < 2 ? 'online' : 'offline',
        lastUpdate: new Date(agora - v.contatoMin * MIN).toISOString(),
      })),
    ),
    getPositions: jest.fn().mockResolvedValue(
      veiculos
        .filter((v) => v.fixMin !== undefined)
        .map((v) => ({
          deviceId: v.deviceId,
          fixTime: new Date(agora - (v.fixMin as number) * MIN).toISOString(),
          speed: 0,
          attributes: { ignition: true },
        })),
    ),
  };
  const alerts = {
    notifyOffline: jest.fn().mockResolvedValue(undefined),
    notifyGpsSilent: jest.fn().mockResolvedValue(undefined),
  };
  const settings = { getForTenant: jest.fn().mockResolvedValue({ offlineThresholdMinutes: 15 }) };
  const cron = new AlertsCron(
    prisma as unknown as PrismaService,
    traccar as unknown as TraccarService,
    alerts as unknown as AlertsService,
    settings as unknown as TenantSettingsService,
  );
  const debug = jest.spyOn((cron as unknown as { logger: { debug: (m: string) => void } }).logger, 'debug').mockImplementation(() => undefined);
  return { cron, prisma, alerts, debug };
}

function comFlag(valor: string | undefined, fn: () => Promise<void>) {
  return async () => {
    const antes = process.env.ALERTS_DEDUP_EPISODIO;
    if (valor === undefined) delete process.env.ALERTS_DEDUP_EPISODIO;
    else process.env.ALERTS_DEDUP_EPISODIO = valor;
    try {
      await fn();
    } finally {
      if (antes === undefined) delete process.env.ALERTS_DEDUP_EPISODIO;
      else process.env.ALERTS_DEDUP_EPISODIO = antes;
    }
  };
}

describe('AlertsCron.detectOffline com ALERTS_DEDUP_EPISODIO', () => {
  it(
    'desligada: usa a janela de 30 min de hoje e não consulta o último alerta',
    comFlag(undefined, async () => {
      const { cron, prisma, alerts } = montar({ veiculos: [{ id: 'v1', deviceId: 1 }], comAlerta: [], lastUpdateMin: 40 });
      (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest.fn();
      await cron.detectOffline();
      expect(prisma.alert.findMany).toHaveBeenCalledTimes(1);
      expect((prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw).not.toHaveBeenCalled();
      expect(alerts.notifyOffline).toHaveBeenCalledTimes(1);
    }),
  );

  it(
    'ligada: mesmo episódio já alertado (alerta depois do último contato) não gera alerta novo',
    comFlag('1', async () => {
      // offline desde T0 = 35 min atrás; último alerta em T0+1 = 34 min atrás
      const { cron, prisma, alerts, debug } = montarEpisodio([{ id: 'v1', deviceId: 1, contatoMin: 35, ultimoAlertaMin: 34 }]);
      await cron.detectOffline();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.alert.findMany).not.toHaveBeenCalled();
      expect(alerts.notifyOffline).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('criados=0 suprimidosPorEpisodio=1'));
    }),
  );

  it(
    'ligada: voltou depois do último alerta e caiu de novo = episódio novo, alerta criado',
    comFlag('1', async () => {
      // último alerta 200 min atrás; voltou em T1 = 61 min atrás e caiu
      const { cron, alerts, debug } = montarEpisodio([{ id: 'v1', deviceId: 1, contatoMin: 61, ultimoAlertaMin: 200 }]);
      await cron.detectOffline();
      expect(alerts.notifyOffline).toHaveBeenCalledTimes(1);
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('criados=1 suprimidosPorEpisodio=0'));
    }),
  );

  it(
    'ligada: nunca alertado gera alerta; a janela de 30 min continua como piso',
    comFlag('1', async () => {
      const { cron, alerts } = montarEpisodio([
        { id: 'novo', deviceId: 1, contatoMin: 20 },
        // episódio novo (alerta antes do contato), mas alerta há 25 min: o piso de 30 min segura
        { id: 'piso', deviceId: 2, contatoMin: 20, ultimoAlertaMin: 25 },
      ]);
      await cron.detectOffline();
      expect(alerts.notifyOffline.mock.calls.map((c) => c[0])).toEqual(['novo']);
    }),
  );
});

describe('AlertsCron.detectGpsSilent com ALERTS_DEDUP_EPISODIO', () => {
  it(
    'ligada: GPS mudo desde o mesmo fix já alertado não gera alerta novo',
    comFlag('1', async () => {
      const { cron, alerts, debug } = montarEpisodio([{ id: 'v1', deviceId: 1, contatoMin: 0, fixMin: 50, ultimoAlertaMin: 34 }]);
      await cron.detectGpsSilent();
      expect(alerts.notifyGpsSilent).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('criados=0 suprimidosPorEpisodio=1'));
    }),
  );

  it(
    'ligada: fix novo depois do último alerta e GPS mudo de novo = alerta criado',
    comFlag('1', async () => {
      const { cron, alerts } = montarEpisodio([
        { id: 'v1', deviceId: 1, contatoMin: 0, fixMin: 61, ultimoAlertaMin: 200 },
        { id: 'v2', deviceId: 2, contatoMin: 0, fixMin: 20 },
      ]);
      await cron.detectGpsSilent();
      expect(alerts.notifyGpsSilent.mock.calls.map((c) => c[0])).toEqual(['v1', 'v2']);
    }),
  );

  it(
    'desligada: janela de 30 min de hoje',
    comFlag('', async () => {
      const { cron, prisma, alerts } = montarEpisodio([{ id: 'v1', deviceId: 1, contatoMin: 0, fixMin: 50, ultimoAlertaMin: 34 }]);
      prisma.alert.findMany.mockResolvedValue([]);
      await cron.detectGpsSilent();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(alerts.notifyGpsSilent).toHaveBeenCalledTimes(1);
    }),
  );
});

describe('ALERTS_DEDUP_EPISODIO por lista de tipos', () => {
  // Mesmo episódio já alertado há 34 min: suprime só onde o dedup por episódio está ligado.
  const offline = [{ id: 'v1', deviceId: 1, contatoMin: 35, ultimoAlertaMin: 34 }];
  const gps = [{ id: 'v1', deviceId: 1, contatoMin: 0, fixMin: 50, ultimoAlertaMin: 34 }];

  async function rodar(flag: string | undefined) {
    let resultado = { offlinePorEpisodio: false, gpsPorEpisodio: false };
    await comFlag(flag, async () => {
      const o = montarEpisodio(offline);
      o.prisma.alert.findMany.mockResolvedValue([]);
      await o.cron.detectOffline();
      const g = montarEpisodio(gps);
      g.prisma.alert.findMany.mockResolvedValue([]);
      await g.cron.detectGpsSilent();
      resultado = {
        offlinePorEpisodio: o.prisma.$queryRaw.mock.calls.length === 1 && o.alerts.notifyOffline.mock.calls.length === 0,
        gpsPorEpisodio: g.prisma.$queryRaw.mock.calls.length === 1 && g.alerts.notifyGpsSilent.mock.calls.length === 0,
      };
      // desligado: janela de 30 min de hoje (findMany) e alerta criado
      if (!resultado.offlinePorEpisodio) {
        expect(o.prisma.alert.findMany).toHaveBeenCalledTimes(1);
        expect(o.alerts.notifyOffline).toHaveBeenCalledTimes(1);
      }
      if (!resultado.gpsPorEpisodio) {
        expect(g.prisma.alert.findMany).toHaveBeenCalledTimes(1);
        expect(g.alerts.notifyGpsSilent).toHaveBeenCalledTimes(1);
      }
    })();
    return resultado;
  }

  it.each([
    ['OFFLINE', true, false],
    ['GPS_SILENT', false, true],
    ['OFFLINE,GPS_SILENT', true, true],
    [' offline , gps_silent ', true, true],
    ['1', true, true],
    ['true', true, true],
    ['', false, false],
    [undefined, false, false],
  ])('ALERTS_DEDUP_EPISODIO=%p → OFFLINE por episódio=%p, GPS_SILENT por episódio=%p', async (flag, off, gpsOn) => {
    expect(await rodar(flag)).toEqual({ offlinePorEpisodio: off, gpsPorEpisodio: gpsOn });
  });
});
