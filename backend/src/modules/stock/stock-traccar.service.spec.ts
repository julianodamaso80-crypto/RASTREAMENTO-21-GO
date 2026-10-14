import { StockTraccarService } from './stock-traccar.service';

/**
 * `/stock/map` custava ~850 ms de CPU por chamada e o painel do escritório
 * pedia em rajadas de 5–7/s (13/10/2026). Com `STOCK_MAP_CACHE_MS` o mapa é
 * montado uma vez por tenant e as chamadas simultâneas esperam a mesma
 * montagem. Sem a env, nada muda.
 */

const AGORA = Date.parse('2026-10-13T15:00:00Z');
const antes = (ms: number) => new Date(AGORA - ms).toISOString();

const DEVICE = {
  id: 7,
  name: '860000000000001',
  uniqueId: '860000000000001',
  status: 'online',
  lastUpdate: antes(30_000),
  positionId: 70,
  groupId: 0,
  phone: '',
  model: '',
  contact: '',
  category: '',
  disabled: false,
  attributes: {},
};

const POSICAO = {
  id: 70,
  deviceId: 7,
  latitude: -22.9,
  longitude: -43.2,
  altitude: 0,
  speed: 0,
  course: 90,
  valid: true,
  accuracy: 5,
  fixTime: antes(60_000),
  deviceTime: antes(60_000),
  serverTime: antes(60_000),
  address: 'Rua A, 1',
  protocol: 'gt06',
  attributes: { sat: 9, ignition: true, power: 12.6, batteryLevel: 80 },
};

const ITEM = {
  id: 'item-1',
  imei: '860000000000001',
  iccid: '8955000000000000001',
  line: '21999990000',
  operator: 'VIVO',
  server: 'gps1',
  status: 'ATIVO',
  validatedAt: null,
  validationOk: null,
  assignedTechnician: { id: 'tec-1', name: 'João' },
};

const TAG = { id: 'tag-1', imei: 'TAG001', status: 'ATIVO', notes: null };

function servico(opts: { traccarFalha?: boolean } = {}) {
  const prisma = {
    stockItem: {
      findMany: jest.fn((args: { where: { kind: string } }) =>
        Promise.resolve(args.where.kind === 'TAG' ? [TAG] : [ITEM]),
      ),
    },
    $queryRaw: jest.fn().mockResolvedValue([
      {
        serial_number: 'TAG001',
        latitude: -22.8,
        longitude: -43.1,
        accuracy_m: 30,
        seen_at: new Date(AGORA - 600_000),
      },
    ]),
  };
  const traccar = {
    getDevices: jest.fn(() =>
      opts.traccarFalha
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve([DEVICE]),
    ),
    getPositions: jest.fn().mockResolvedValue([POSICAO]),
  };
  const geocode = {
    lookupCached: jest.fn().mockResolvedValue(new Map()),
    chave: jest.fn(
      (p: { latitude: number; longitude: number }) =>
        `${p.latitude},${p.longitude}`,
    ),
  };
  const s = new StockTraccarService(
    prisma as never,
    traccar as never,
    geocode as never,
  );
  return { s, traccar, prisma };
}

describe('StockTraccarService.mapPoints — cache por tenant', () => {
  const envOriginal = process.env.STOCK_MAP_CACHE_MS;
  let agora: number;

  beforeEach(() => {
    agora = AGORA;
    jest.spyOn(Date, 'now').mockImplementation(() => agora);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (envOriginal === undefined) delete process.env.STOCK_MAP_CACHE_MS;
    else process.env.STOCK_MAP_CACHE_MS = envOriginal;
  });

  describe('com STOCK_MAP_CACHE_MS=10000', () => {
    beforeEach(() => {
      process.env.STOCK_MAP_CACHE_MS = '10000';
    });

    it('10 chamadas simultâneas do mesmo tenant montam 1×; outro tenant monta o seu', async () => {
      const { s, traccar } = servico();

      const resultados = await Promise.all(
        Array.from({ length: 10 }, () => s.mapPoints('t1')),
      );
      expect(traccar.getDevices).toHaveBeenCalledTimes(1);
      for (const r of resultados) expect(r).toBe(resultados[0]);
      expect(resultados[0].geradoEm).toBe(new Date(AGORA).toISOString());

      await s.mapPoints('t2');
      expect(traccar.getDevices).toHaveBeenCalledTimes(2);
    });

    it('Traccar fora: entrega as TAGs com indisponivel e tenta de novo 4 s depois', async () => {
      const { s, traccar } = servico({ traccarFalha: true });

      const r = await s.mapPoints('t1');
      expect(r.indisponivel).toBe(true);
      expect(r.pontos.map((p) => p.id)).toEqual(['tag-1']);

      agora += 2_000;
      await s.mapPoints('t1');
      expect(traccar.getDevices).toHaveBeenCalledTimes(1);

      agora += 2_000;
      await s.mapPoints('t1');
      expect(traccar.getDevices).toHaveBeenCalledTimes(2);
    });

    it('invalidarMapa entre duas chamadas força nova montagem', async () => {
      const { s, traccar } = servico();
      await s.mapPoints('t1');
      s.invalidarMapa('t1');
      await s.mapPoints('t1');
      expect(traccar.getDevices).toHaveBeenCalledTimes(2);
    });

    it('invalidarMapa do t1 não afeta o t2', async () => {
      const { s, traccar } = servico();
      await s.mapPoints('t1');
      await s.mapPoints('t2');
      s.invalidarMapa('t1');
      await s.mapPoints('t2');
      expect(traccar.getDevices).toHaveBeenCalledTimes(2);
      await s.mapPoints('t1');
      expect(traccar.getDevices).toHaveBeenCalledTimes(3);
    });
  });

  it('ensureDevice que grava o device no item invalida o mapa do tenant do item', async () => {
    process.env.STOCK_MAP_CACHE_MS = '10000';
    const { s, traccar, prisma } = servico();
    Object.assign(traccar, {
      getDeviceByUniqueId: jest.fn().mockResolvedValue(DEVICE),
    });
    Object.assign(prisma.stockItem, {
      update: jest.fn().mockResolvedValue({ tenantId: 't1' }),
    });

    await s.mapPoints('t1');
    await s.mapPoints('t2');
    await s.ensureDevice({ id: 'item-1', imei: ITEM.imei, traccarDeviceId: null });
    await s.mapPoints('t1');
    await s.mapPoints('t2');

    expect(traccar.getDevices).toHaveBeenCalledTimes(3);
  });

  describe('com STOCK_MAP_CACHE_MS ausente (caminho de hoje)', () => {
    beforeEach(() => {
      delete process.env.STOCK_MAP_CACHE_MS;
    });

    it('cada chamada monta, e o payload é o de antes mais geradoEm', async () => {
      const { s, traccar } = servico();

      await s.mapPoints('t1');
      await s.mapPoints('t1');
      const r = await s.mapPoints('t1');
      expect(traccar.getDevices).toHaveBeenCalledTimes(3);

      expect(Object.keys(r).sort()).toEqual(['geradoEm', 'indisponivel', 'pontos']);
      expect(r.geradoEm).toBe(new Date(AGORA).toISOString());
      expect(r.indisponivel).toBe(false);
      expect(r.pontos).toEqual([
        {
          id: 'item-1',
          imei: '860000000000001',
          iccid: '8955000000000000001',
          line: '21999990000',
          operator: 'VIVO',
          server: 'gps1',
          statusChip: 'ATIVO',
          validatedAt: null,
          validationOk: null,
          tecnico: 'João',
          conexao: 'ONLINE',
          lastUpdate: antes(30_000),
          fixTime: antes(60_000),
          idadeSegundos: 60,
          latitude: -22.9,
          longitude: -43.2,
          endereco: 'Rua A, 1',
          gpsConfiavel: true,
          ignicao: true,
          velocidade: 0,
          direcao: 90,
          volts: 12.6,
          faixaEnergia: expect.any(String),
          satelites: 9,
          bateriaInterna: 80,
          bloqueado: false,
        },
        {
          id: 'tag-1',
          imei: 'TAG001',
          tipo: 'TAG',
          iccid: null,
          line: null,
          operator: null,
          server: null,
          statusChip: 'ATIVO',
          validatedAt: null,
          validationOk: null,
          tecnico: null,
          conexao: 'NUNCA',
          lastUpdate: null,
          fixTime: new Date(AGORA - 600_000).toISOString(),
          idadeSegundos: 600,
          latitude: -22.8,
          longitude: -43.1,
          endereco: null,
          gpsConfiavel: false,
          precisaoM: 30,
          ignicao: null,
          velocidade: null,
          direcao: null,
          volts: null,
          faixaEnergia: 'ausente',
          satelites: null,
          bateriaInterna: null,
          bloqueado: false,
        },
      ]);
    });

    it('valor inválido ou zero também é desligado', async () => {
      for (const valor of ['0', 'abc', '-5']) {
        process.env.STOCK_MAP_CACHE_MS = valor;
        const { s, traccar } = servico();
        await Promise.all([s.mapPoints('t1'), s.mapPoints('t1')]);
        expect(traccar.getDevices).toHaveBeenCalledTimes(2);
      }
    });
  });
});
