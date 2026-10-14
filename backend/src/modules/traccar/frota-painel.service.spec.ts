import { FrotaPainelService, etagCasa } from './frota-painel.service';

/**
 * `/traccar/devices` e `/traccar/positions` filtravam ~10 mil devices com
 * `deviceIds.includes` a cada chamada (~450 ms de CPU, 13/10/2026). Com
 * `FROTA_PAINEL_CACHE_MS` a frota do tenant é montada uma vez por janela e
 * as chamadas simultâneas esperam a mesma montagem. Sem a env, nada muda.
 */

function gerador(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const device = (id: number) => ({ id, name: `d${id}`, status: 'online' });
const posicao = (deviceId: number, lat = -22.9) => ({
  id: deviceId * 10,
  deviceId,
  latitude: lat,
  fixTime: '2026-10-13T15:00:00.000Z',
});

interface Cenario {
  veiculos: Record<string, Array<{ traccarDeviceId: number | null }>>;
  devices: Array<{ id: number }>;
  posicoes: Array<{ deviceId: number; latitude?: number }>;
}

function servico(cacheMs: string | undefined, cenario: Cenario) {
  if (cacheMs === undefined) delete process.env.FROTA_PAINEL_CACHE_MS;
  else process.env.FROTA_PAINEL_CACHE_MS = cacheMs;
  const prisma = {
    vehicle: {
      findMany: jest.fn((args: { where: { tenantId: string } }) =>
        Promise.resolve(cenario.veiculos[args.where.tenantId] ?? []),
      ),
    },
  };
  const traccar = {
    getDevices: jest.fn(() => Promise.resolve(cenario.devices)),
    getPositions: jest.fn(() => Promise.resolve(cenario.posicoes)),
    frotaBuscadaEm: jest.fn<number | null, [string]>(() => null),
  };
  const s = new FrotaPainelService(prisma as never, traccar as never);
  return { s, prisma, traccar };
}

describe('FrotaPainelService', () => {
  const envOriginal = process.env.FROTA_PAINEL_CACHE_MS;
  afterEach(() => {
    if (envOriginal === undefined) delete process.env.FROTA_PAINEL_CACHE_MS;
    else process.env.FROTA_PAINEL_CACHE_MS = envOriginal;
  });

  const base: Cenario = {
    veiculos: {
      'tenant-a': [{ traccarDeviceId: 1 }, { traccarDeviceId: 3 }],
      'tenant-b': [{ traccarDeviceId: 2 }],
    },
    devices: [device(1), device(2), device(3), device(4)],
    posicoes: [posicao(3), posicao(2), posicao(1), posicao(4)],
  };

  it('10 chamadas simultâneas montam uma vez só', async () => {
    const { s, prisma, traccar } = servico('2000', base);
    const frotas = await Promise.all(
      Array.from({ length: 10 }, () => s.frotaDoTenant('tenant-a')),
    );
    expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(1);
    expect(traccar.getDevices).toHaveBeenCalledTimes(1);
    expect(traccar.getPositions).toHaveBeenCalledTimes(1);
    for (const f of frotas) expect(f).toBe(frotas[0]);
  });

  it('consulta só os veículos do tenant, com o mesmo filtro de hoje', async () => {
    const { s, prisma } = servico('2000', base);
    await s.frotaDoTenant('tenant-a');
    expect(prisma.vehicle.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        traccarDeviceId: { not: null },
        deletedAt: null,
      },
      select: { traccarDeviceId: true },
    });
  });

  it('tenants diferentes: listas próprias e etags diferentes', async () => {
    const { s } = servico('2000', base);
    const [a, b] = await Promise.all([
      s.frotaDoTenant('tenant-a'),
      s.frotaDoTenant('tenant-b'),
    ]);
    expect(a.devices.map((d) => d.id)).toEqual([1, 3]);
    expect(a.positions.map((p) => p.deviceId)).toEqual([3, 1]);
    expect(b.devices.map((d) => d.id)).toEqual([2]);
    expect(b.positions.map((p) => p.deviceId)).toEqual([2]);
    expect(a.etagDevices).not.toBe(b.etagDevices);
    expect(a.etagPositions).not.toBe(b.etagPositions);
  });

  it('etag é weak, com 20 hex de sha1', async () => {
    const { s } = servico('2000', base);
    const f = await s.frotaDoTenant('tenant-a');
    expect(f.etagDevices).toMatch(/^W\/"[0-9a-f]{20}"$/);
    expect(f.etagPositions).toMatch(/^W\/"[0-9a-f]{20}"$/);
    expect(typeof f.geradoEm).toBe('number');
  });

  it.each([1, 2, 3])(
    'lista filtrada é igual à do algoritmo antigo (includes), seed %i',
    async (seed) => {
      const rnd = gerador(seed);
      const devices = Array.from({ length: 500 }, () =>
        device(1 + Math.floor(rnd() * 800)),
      );
      const posicoes = Array.from({ length: 400 }, () =>
        posicao(1 + Math.floor(rnd() * 800), rnd()),
      );
      const veiculos = Array.from({ length: 300 }, () => ({
        traccarDeviceId: rnd() < 0.1 ? null : 1 + Math.floor(rnd() * 800),
      }));
      const { s } = servico('2000', {
        veiculos: { t: veiculos },
        devices,
        posicoes,
      });

      const deviceIds = veiculos
        .map((v) => v.traccarDeviceId)
        .filter((id): id is number => id !== null);
      const antigoDevices = devices.filter((d) => deviceIds.includes(d.id));
      const antigoPosicoes = posicoes.filter((p) =>
        deviceIds.includes(p.deviceId),
      );

      const f = await s.frotaDoTenant('t');
      expect(f.devices).toEqual(antigoDevices);
      expect(f.positions).toEqual(antigoPosicoes);
      expect(antigoDevices.length).toBeGreaterThan(0);
    },
  );

  it('tenant sem veículo: listas vazias com etag próprio, sem ir ao Traccar', async () => {
    const { s, traccar } = servico('2000', base);
    const f = await s.frotaDoTenant('tenant-vazio');
    expect(f.devices).toEqual([]);
    expect(f.positions).toEqual([]);
    expect(f.etagDevices).toMatch(/^W\/"[0-9a-f]{20}"$/);
    expect(traccar.getDevices).not.toHaveBeenCalled();
    expect(traccar.getPositions).not.toHaveBeenCalled();
  });

  it('mesma frota → mesmo etag; posição mudou → etag de positions muda', async () => {
    const cenario: Cenario = {
      ...base,
      posicoes: [posicao(3), posicao(1)],
    };
    const { s } = servico('0', cenario);
    const f1 = await s.frotaDoTenant('tenant-a');
    const f2 = await s.frotaDoTenant('tenant-a');
    expect(f2.etagDevices).toBe(f1.etagDevices);
    expect(f2.etagPositions).toBe(f1.etagPositions);

    cenario.posicoes = [posicao(3, -22.8), posicao(1)];
    const f3 = await s.frotaDoTenant('tenant-a');
    expect(f3.etagPositions).not.toBe(f1.etagPositions);
    expect(f3.etagDevices).toBe(f1.etagDevices);
  });

  it.each([['0'], [undefined], ['abc']])(
    'flag %p → desligado, monta a cada chamada',
    async (flag) => {
      const { s, prisma, traccar } = servico(flag, base);
      expect(s.ligado).toBe(false);
      await s.frotaDoTenant('tenant-a');
      await s.frotaDoTenant('tenant-a');
      await s.frotaDoTenant('tenant-a');
      expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(3);
      expect(traccar.getDevices).toHaveBeenCalledTimes(3);
    },
  );

  it('flag ligada: dentro do TTL não monta de novo; depois dele, monta', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-13T15:00:00Z') });
    try {
      const { s, prisma } = servico('2000', base);
      expect(s.ligado).toBe(true);
      await s.frotaDoTenant('tenant-a');
      jest.setSystemTime(Date.now() + 1_999);
      await s.frotaDoTenant('tenant-a');
      expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(1);
      jest.setSystemTime(Date.now() + 2);
      await s.frotaDoTenant('tenant-a');
      expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('idade medida desde a busca no Traccar', () => {
    const T0 = Date.parse('2026-10-13T15:00:00Z');
    beforeEach(() => jest.useFakeTimers({ now: T0 }));
    afterEach(() => jest.useRealTimers());

    it('busca em t0 e montagem em t0+1.500 → expira em t0+2.000, não em t0+3.500', async () => {
      const { s, prisma, traccar } = servico('2000', base);
      traccar.frotaBuscadaEm.mockReturnValue(T0);
      jest.setSystemTime(T0 + 1_500);
      const f = await s.frotaDoTenant('tenant-a');
      expect(f.geradoEm).toBe(T0);

      jest.setSystemTime(T0 + 1_999);
      await s.frotaDoTenant('tenant-a');
      expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(1);

      jest.setSystemTime(T0 + 2_000);
      traccar.frotaBuscadaEm.mockReturnValue(T0 + 2_000);
      await s.frotaDoTenant('tenant-a');
      expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(2);
    });

    it('geradoEm é a busca mais antiga entre devices e positions', async () => {
      const { s, traccar } = servico('2000', base);
      traccar.frotaBuscadaEm.mockImplementation((rota: string) =>
        rota === '/devices' ? T0 - 300 : T0 - 1_200,
      );
      const f = await s.frotaDoTenant('tenant-a');
      expect(traccar.frotaBuscadaEm).toHaveBeenCalledWith('/devices');
      expect(traccar.frotaBuscadaEm).toHaveBeenCalledWith('/positions');
      expect(f.geradoEm).toBe(T0 - 1_200);
    });

    it('sem registro da busca → geradoEm = agora', async () => {
      const { s } = servico('2000', base);
      jest.setSystemTime(T0 + 42);
      const f = await s.frotaDoTenant('tenant-a');
      expect(f.geradoEm).toBe(T0 + 42);
    });

    it('busca já mais velha que o TTL → não guarda', async () => {
      const { s, prisma, traccar } = servico('2000', base);
      traccar.frotaBuscadaEm.mockReturnValue(T0 - 2_500);
      await s.frotaDoTenant('tenant-a');
      await s.frotaDoTenant('tenant-a');
      expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('falha de um lado não derruba o outro', () => {
    it('positions falha → devices servidos, erro de positions guardado', async () => {
      const { s, traccar } = servico('2000', base);
      const erro = new Error('positions fora');
      traccar.getPositions.mockRejectedValueOnce(erro);
      const f = await s.frotaDoTenant('tenant-a');
      expect(f.devices.map((d) => d.id)).toEqual([1, 3]);
      expect(f.erroDevices).toBeUndefined();
      expect(f.erroPositions).toBe(erro);
      expect(f.positions).toEqual([]);
    });

    it('devices falha → positions servidas, erro de devices guardado', async () => {
      const { s, traccar } = servico('2000', base);
      const erro = new Error('devices fora');
      traccar.getDevices.mockRejectedValueOnce(erro);
      const f = await s.frotaDoTenant('tenant-a');
      expect(f.positions.map((p) => p.deviceId)).toEqual([3, 1]);
      expect(f.erroPositions).toBeUndefined();
      expect(f.erroDevices).toBe(erro);
      expect(f.devices).toEqual([]);
    });

    it('os dois ok → sem erro', async () => {
      const { s } = servico('2000', base);
      const f = await s.frotaDoTenant('tenant-a');
      expect(f.erroDevices).toBeUndefined();
      expect(f.erroPositions).toBeUndefined();
    });

    it('resultado com erro dura no máximo 1 s', async () => {
      const T0 = Date.parse('2026-10-13T15:00:00Z');
      jest.useFakeTimers({ now: T0 });
      try {
        const { s, prisma, traccar } = servico('2000', base);
        traccar.getDevices.mockRejectedValueOnce(new Error('traccar fora'));
        const f1 = await s.frotaDoTenant('tenant-a');
        expect(f1.erroDevices).toBeDefined();

        jest.setSystemTime(T0 + 999);
        await s.frotaDoTenant('tenant-a');
        expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(1);

        jest.setSystemTime(T0 + 1_000);
        const f2 = await s.frotaDoTenant('tenant-a');
        expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(2);
        expect(f2.erroDevices).toBeUndefined();
        expect(f2.devices.map((d) => d.id)).toEqual([1, 3]);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('mesma lista em tenants diferentes → etags diferentes', async () => {
    const { s } = servico('2000', {
      ...base,
      veiculos: {
        'tenant-a': [{ traccarDeviceId: 1 }],
        'tenant-b': [{ traccarDeviceId: 1 }],
      },
    });
    const a = await s.frotaDoTenant('tenant-a');
    const b = await s.frotaDoTenant('tenant-b');
    expect(b.devices).toEqual(a.devices);
    expect(b.etagDevices).not.toBe(a.etagDevices);
    expect(b.etagPositions).not.toBe(a.etagPositions);
  });
});

describe('etagCasa', () => {
  const etag = 'W/"0123456789abcdef0123"';
  it.each([
    [undefined, false],
    ['', false],
    ['*', false],
    [etag, true],
    ['"0123456789abcdef0123"', true],
    [`W/"outro", ${etag}`, true],
    ['W/"outro"', false],
    ['W/"0123456789abcdef012"', false],
  ])('If-None-Match %p → %p', (inm, esperado) => {
    expect(etagCasa(inm, etag)).toBe(esperado);
  });
});
