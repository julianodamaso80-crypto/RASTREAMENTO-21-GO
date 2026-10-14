import { performance } from 'node:perf_hooks';
import { TraccarController } from './traccar.controller';
import { FrotaPainelService } from './frota-painel.service';

/**
 * Medição SINTÉTICA do `/traccar/devices`: frota do tamanho da de produção
 * (13/10/2026), com Traccar e Postgres mockados. Mede só a CPU deste processo
 * filtrando a frota no controller — não o custo do Traccar, do banco, da
 * serialização HTTP nem da rede.
 *
 * 100 chamadas em 10 s, desligado (caminho de hoje, `includes`) × ligado
 * (`FROTA_PAINEL_CACHE_MS=2000`).
 *
 * Fica fora da suíte padrão. Para rodar:
 *   PERF=1 npx jest frota-painel.perf
 */

const DEVICES = 10_428;
const POSICOES = 8_865;
const VEICULOS = 7_000;
const CHAMADAS = 100;
const JANELA_MS = 10_000;
const PERF = process.env.PERF === '1';

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
      attributes: { sat: Math.floor(rnd() * 14), ignition: rnd() < 0.5 },
    };
  });
  // Ids espalhados pela frota toda, como os veículos reais.
  const veiculos = Array.from({ length: VEICULOS }, (_, i) => ({
    traccarDeviceId: 1 + Math.floor((i * DEVICES) / VEICULOS),
  }));
  return { devices, posicoes, veiculos };
}

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[
    Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)
  ];
}

async function rajada(cacheMs: string | undefined) {
  if (cacheMs === undefined) delete process.env.FROTA_PAINEL_CACHE_MS;
  else process.env.FROTA_PAINEL_CACHE_MS = cacheMs;

  const { devices, posicoes, veiculos } = frota();
  const prisma = {
    vehicle: { findMany: jest.fn().mockResolvedValue(veiculos) },
  };
  const traccar = {
    getDevices: jest.fn().mockResolvedValue(devices),
    getPositions: jest.fn().mockResolvedValue(posicoes),
  };
  const servico = new FrotaPainelService(prisma as never, traccar as never);
  const controller = new TraccarController(
    traccar as never,
    prisma as never,
    servico,
  );
  const res = { setHeader: () => undefined, status: () => res };
  const req = {
    tenantId: 'tenant-1',
    user: { id: 'u', tenantId: 'tenant-1', role: 'ADMIN' },
  };

  const latencias: number[] = [];
  let itens = 0;
  const cpuAntes = process.cpuUsage();
  const pedidos: Promise<void>[] = [];
  const intervalo = JANELA_MS / CHAMADAS;

  for (let i = 0; i < CHAMADAS; i++) {
    const inicio = performance.now();
    pedidos.push(
      controller.getDevices(req, undefined, res as never).then((lista) => {
        latencias.push(performance.now() - inicio);
        itens = lista?.length ?? 0;
      }),
    );
    await new Promise((r) => setTimeout(r, intervalo));
  }
  await Promise.all(pedidos);
  const cpu = process.cpuUsage(cpuAntes);
  const cpuMs = (cpu.user + cpu.system) / 1000;

  return {
    montagens: traccar.getDevices.mock.calls.length,
    itens,
    cpuMs: Math.round(cpuMs),
    cpuPorChamadaMs: +(cpuMs / CHAMADAS).toFixed(2),
    p50: +percentil(latencias, 50).toFixed(2),
    p95: +percentil(latencias, 95).toFixed(2),
  };
}

(PERF ? describe : describe.skip)(
  '/traccar/devices — medição sintética da frota do painel (10.428 devices)',
  () => {
    const envOriginal = process.env.FROTA_PAINEL_CACHE_MS;
    afterAll(() => {
      if (envOriginal === undefined) delete process.env.FROTA_PAINEL_CACHE_MS;
      else process.env.FROTA_PAINEL_CACHE_MS = envOriginal;
    });

    it('100 chamadas em 10 s: ligado monta ≤ 6× e gasta < 10 % da CPU por chamada', async () => {
      const desligado = await rajada(undefined);
      const ligado = await rajada('2000');

      if (PERF) {
        console.log(
          `[frota-painel sintético] desligado=${JSON.stringify(desligado)} ligado=${JSON.stringify(ligado)}`,
        );
      }

      expect(ligado.itens).toBe(desligado.itens);
      expect(desligado.montagens).toBe(CHAMADAS);
      expect(ligado.montagens).toBeLessThanOrEqual(6);
      expect(ligado.cpuPorChamadaMs).toBeLessThan(
        desligado.cpuPorChamadaMs * 0.1,
      );
    }, 180_000);
  },
);
