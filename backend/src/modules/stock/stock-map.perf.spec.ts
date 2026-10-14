import { performance } from 'node:perf_hooks';
import { StockTraccarService } from './stock-traccar.service';

/**
 * Medição SINTÉTICA do cache do `/stock/map`: frota do tamanho da de produção
 * (13/10/2026), mas com Traccar, Postgres e geocoder mockados. Mede só a CPU
 * deste processo montando o mapa — não o custo do Traccar nem do banco.
 *
 * Rajada igual à medida no escritório: 60 chamadas em 10 s (6/s).
 */

const DEVICES = 10_428;
const POSICOES = 8_865;
const ITENS = 9_386;
const CHAMADAS = 60;
const JANELA_MS = 10_000;

/** Gerador determinístico (mulberry32) — a mesma frota em toda execução. */
function gerador(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function frota() {
  const rnd = gerador(20261013);
  const agora = Date.now();
  const imei = (i: number) => String(860000000000000 + i);
  const devices = Array.from({ length: DEVICES }, (_, i) => ({
    id: i + 1,
    name: imei(i),
    uniqueId: imei(i),
    status: rnd() < 0.3 ? 'online' : 'offline',
    lastUpdate: new Date(
      agora - Math.floor(rnd() * 5 * 86_400_000),
    ).toISOString(),
    positionId: i + 1,
    groupId: 0,
    phone: '',
    model: '',
    contact: '',
    category: '',
    disabled: false,
    attributes: {},
  }));
  const posicoes = Array.from({ length: POSICOES }, (_, i) => {
    const fix = new Date(agora - Math.floor(rnd() * 86_400_000)).toISOString();
    return {
      id: i + 1,
      deviceId: i + 1,
      latitude: -22.9 + rnd() * 0.5,
      longitude: -43.5 + rnd() * 0.5,
      altitude: 0,
      speed: rnd() < 0.5 ? 0 : rnd() * 60,
      course: Math.floor(rnd() * 360),
      valid: rnd() < 0.9,
      accuracy: 5,
      fixTime: fix,
      deviceTime: fix,
      serverTime: fix,
      protocol: 'gt06',
      attributes: {
        sat: Math.floor(rnd() * 14),
        ignition: rnd() < 0.5,
        power: 11 + rnd() * 3,
        batteryLevel: Math.floor(rnd() * 100),
      },
    };
  });
  const itens = Array.from({ length: ITENS }, (_, i) => ({
    id: `item-${i}`,
    imei: imei(i),
    iccid: `8955${String(i).padStart(15, '0')}`,
    line: null,
    operator: 'VIVO',
    server: 'gps1',
    status: 'ATIVO',
    validatedAt: null,
    validationOk: null,
    assignedTechnician: null,
  }));
  return { devices, posicoes, itens };
}

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[
    Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)
  ];
}

async function rajada(cacheMs: string | undefined) {
  if (cacheMs === undefined) delete process.env.STOCK_MAP_CACHE_MS;
  else process.env.STOCK_MAP_CACHE_MS = cacheMs;

  const { devices, posicoes, itens } = frota();
  const prisma = {
    stockItem: {
      findMany: jest.fn((args: { where: { kind: string } }) =>
        Promise.resolve(args.where.kind === 'TAG' ? [] : itens),
      ),
    },
  };
  const traccar = {
    getDevices: jest.fn().mockResolvedValue(devices),
    getPositions: jest.fn().mockResolvedValue(posicoes),
  };
  const geocode = {
    lookupCached: jest.fn().mockResolvedValue(new Map()),
    chave: (p: { latitude: number; longitude: number }) =>
      `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`,
  };
  const s = new StockTraccarService(
    prisma as never,
    traccar as never,
    geocode as never,
  );
  const montar = jest.spyOn(
    s as unknown as { montarMapPoints: (t: string) => Promise<unknown> },
    'montarMapPoints',
  );

  const latencias: number[] = [];
  const latenciasAcerto: number[] = [];
  const cpuAntes = process.cpuUsage();
  const pedidos: Promise<void>[] = [];
  const intervalo = JANELA_MS / CHAMADAS;

  for (let i = 0; i < CHAMADAS; i++) {
    const montagensAntes = montar.mock.calls.length;
    const inicio = performance.now();
    const pedido = s.mapPoints('tenant-1');
    const acerto = montar.mock.calls.length === montagensAntes;
    pedidos.push(
      pedido.then(() => {
        const ms = performance.now() - inicio;
        latencias.push(ms);
        if (acerto) latenciasAcerto.push(ms);
      }),
    );
    await new Promise((r) => setTimeout(r, intervalo));
  }
  await Promise.all(pedidos);
  const cpu = process.cpuUsage(cpuAntes);

  return {
    montagens: montar.mock.calls.length,
    cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    p50: +percentil(latencias, 50).toFixed(2),
    p95: +percentil(latencias, 95).toFixed(2),
    acertos: latenciasAcerto.length,
    p50Acerto: +percentil(latenciasAcerto, 50).toFixed(2),
    p95Acerto: +percentil(latenciasAcerto, 95).toFixed(2),
  };
}

describe('/stock/map — medição sintética do cache (10.428 devices)', () => {
  const envOriginal = process.env.STOCK_MAP_CACHE_MS;
  afterAll(() => {
    if (envOriginal === undefined) delete process.env.STOCK_MAP_CACHE_MS;
    else process.env.STOCK_MAP_CACHE_MS = envOriginal;
  });

  it('60 chamadas em 10 s: desligado monta 60×, ligado monta ≤ 2× e responde rápido', async () => {
    const desligado = await rajada(undefined);
    const ligado = await rajada('10000');

    console.log(
      `[stock-map sintético] desligado=${JSON.stringify(desligado)} ligado=${JSON.stringify(ligado)}`,
    );

    expect(desligado.montagens).toBe(CHAMADAS);
    expect(ligado.montagens).toBeLessThanOrEqual(2);
    expect(ligado.p95Acerto).toBeLessThan(50);
  }, 60_000);
});
