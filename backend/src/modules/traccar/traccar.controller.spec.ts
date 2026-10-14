import { TraccarController } from './traccar.controller';
import type { FrotaPainel } from './frota-painel.service';

/**
 * Com `FROTA_PAINEL_CACHE_MS` ligado, `/traccar/devices` e `/traccar/positions`
 * mandam `ETag` e respondem 304 sem montar nada quando o navegador já tem a
 * versão. Desligado, o caminho é o de antes, sem cabeçalho novo.
 */

const ETAG_A_DEV = 'W/"aaaaaaaaaaaaaaaaaaaa"';
const ETAG_A_POS = 'W/"bbbbbbbbbbbbbbbbbbbb"';
const ETAG_B_DEV = 'W/"cccccccccccccccccccc"';
const ETAG_B_POS = 'W/"dddddddddddddddddddd"';

const frotas: Record<string, FrotaPainel> = {
  'tenant-a': {
    devices: [{ id: 1 }] as never,
    positions: [{ id: 10, deviceId: 1 }] as never,
    etagDevices: ETAG_A_DEV,
    etagPositions: ETAG_A_POS,
    geradoEm: 1,
  },
  'tenant-b': {
    devices: [{ id: 2 }] as never,
    positions: [{ id: 20, deviceId: 2 }] as never,
    etagDevices: ETAG_B_DEV,
    etagPositions: ETAG_B_POS,
    geradoEm: 1,
  },
};

const req = (tenantId: string) => ({
  tenantId,
  user: { id: 'u', tenantId, role: 'ADMIN' },
});

function montar(ligado: boolean) {
  const prisma = {
    vehicle: {
      findMany: jest.fn().mockResolvedValue([
        { traccarDeviceId: 1, plate: 'AAA', id: 'v1' },
        { traccarDeviceId: null, plate: 'BBB', id: 'v2' },
      ]),
    },
  };
  const traccar = {
    getDevices: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
    getPositions: jest.fn().mockResolvedValue([
      { id: 20, deviceId: 2 },
      { id: 10, deviceId: 1 },
    ]),
  };
  const frota = {
    ligado,
    frotaDoTenant: jest.fn((t: string) => Promise.resolve(frotas[t])),
  };
  const res = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
  const controller = new TraccarController(
    traccar as never,
    prisma as never,
    frota as never,
  );
  return { controller, prisma, traccar, frota, res };
}

describe('TraccarController — frota do painel com etag', () => {
  describe.each([
    ['getDevices', 'devices', ETAG_A_DEV, ETAG_B_DEV] as const,
    ['getPositions', 'positions', ETAG_A_POS, ETAG_B_POS] as const,
  ])('%s (flag ligada)', (metodo, campo, etagA, etagB) => {
    it('sem If-None-Match → corpo, ETag e Cache-Control', async () => {
      const { controller, res } = montar(true);
      const corpo = await controller[metodo](
        req('tenant-a'),
        undefined,
        res as never,
      );
      expect(corpo).toBe(frotas['tenant-a'][campo]);
      expect(res.setHeader).toHaveBeenCalledWith('ETag', etagA);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-cache',
      );
      expect(res.status).not.toHaveBeenCalled();
    });

    it('If-None-Match igual → 304 e retorno undefined', async () => {
      const { controller, res } = montar(true);
      const corpo = await controller[metodo](
        req('tenant-a'),
        etagA,
        res as never,
      );
      expect(corpo).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(304);
      expect(res.setHeader).toHaveBeenCalledWith('ETag', etagA);
    });

    it('If-None-Match de outro tenant → 200 com a lista do tenant', async () => {
      const { controller, res } = montar(true);
      const corpo = await controller[metodo](
        req('tenant-a'),
        etagB,
        res as never,
      );
      expect(corpo).toBe(frotas['tenant-a'][campo]);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('usa a frota do tenant do JWT e não toca no caminho antigo', async () => {
      const { controller, res, frota, prisma, traccar } = montar(true);
      await controller[metodo](req('tenant-b'), undefined, res as never);
      expect(frota.frotaDoTenant).toHaveBeenCalledWith('tenant-b');
      expect(prisma.vehicle.findMany).not.toHaveBeenCalled();
      expect(traccar.getDevices).not.toHaveBeenCalled();
      expect(traccar.getPositions).not.toHaveBeenCalled();
    });
  });

  describe('falha de um lado (flag ligada)', () => {
    it('positions falhou → /devices 200 e /positions relança o mesmo erro', async () => {
      const { controller, res, frota } = montar(true);
      const erro = new Error('positions fora');
      frota.frotaDoTenant.mockResolvedValue({
        ...frotas['tenant-a'],
        positions: [],
        erroPositions: erro,
      });
      await expect(
        controller.getDevices(req('tenant-a'), undefined, res as never),
      ).resolves.toEqual([{ id: 1 }]);
      await expect(
        controller.getPositions(req('tenant-a'), undefined, res as never),
      ).rejects.toBe(erro);
    });

    it('devices falhou → /positions 200 e /devices relança o mesmo erro', async () => {
      const { controller, res, frota } = montar(true);
      const erro = new Error('devices fora');
      frota.frotaDoTenant.mockResolvedValue({
        ...frotas['tenant-a'],
        devices: [],
        erroDevices: erro,
      });
      await expect(
        controller.getPositions(req('tenant-a'), undefined, res as never),
      ).resolves.toEqual([{ id: 10, deviceId: 1 }]);
      await expect(
        controller.getDevices(req('tenant-a'), undefined, res as never),
      ).rejects.toBe(erro);
    });

    it('erro não manda ETag nem 304', async () => {
      const { controller, res, frota } = montar(true);
      frota.frotaDoTenant.mockResolvedValue({
        ...frotas['tenant-a'],
        erroDevices: new Error('x'),
      });
      await expect(
        controller.getDevices(req('tenant-a'), ETAG_A_DEV, res as never),
      ).rejects.toThrow('x');
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('flag desligada → caminho de hoje', () => {
    it('getDevices: corpo de hoje, sem cabeçalho', async () => {
      const { controller, res, frota } = montar(false);
      const corpo = await controller.getDevices(
        req('tenant-a'),
        'W/"qualquer"',
        res as never,
      );
      expect(corpo).toEqual([{ id: 1 }]);
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(frota.frotaDoTenant).not.toHaveBeenCalled();
    });

    it('getPositions: corpo de hoje, sem cabeçalho', async () => {
      const { controller, res, frota } = montar(false);
      const corpo = await controller.getPositions(
        req('tenant-a'),
        undefined,
        res as never,
      );
      expect(corpo).toEqual([{ id: 10, deviceId: 1 }]);
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(frota.frotaDoTenant).not.toHaveBeenCalled();
    });
  });
});
