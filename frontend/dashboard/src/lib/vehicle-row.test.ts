import type { Vehicle } from '@/types/vehicle';
import type { TraccarDevice, TraccarPosition } from '@/types/traccar';
import { criarCacheLinhas, derivarLinha } from './vehicle-row';

const AGORA = Date.parse('2026-10-14T12:00:00.000Z');
const haMin = (min: number) => new Date(AGORA - min * 60_000).toISOString();

function veiculo(id: string, extra: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    plate: `ABC${id}`,
    vehicleType: 'CAR',
    brand: null,
    model: null,
    year: null,
    color: null,
    chassi: null,
    renavam: null,
    uniqueId: `u${id}`,
    traccarDeviceId: Number(id),
    status: 'ACTIVE',
    tenantId: 't1',
    associateId: null,
    hinovaCode: null,
    lastSync: null,
    deletedAt: null,
    createdAt: haMin(10_000),
    updatedAt: haMin(5),
    associate: null,
    ...extra,
  };
}

function device(id: number, extra: Partial<TraccarDevice> = {}): TraccarDevice {
  return {
    id,
    name: `d${id}`,
    uniqueId: `u${id}`,
    status: 'online',
    lastUpdate: haMin(1),
    positionId: 1,
    groupId: 0,
    phone: '',
    model: 'gt06',
    contact: '',
    category: '',
    disabled: false,
    attributes: {},
    ...extra,
  };
}

function posicao(deviceId: number, extra: Partial<TraccarPosition> = {}): TraccarPosition {
  return {
    id: deviceId * 10,
    deviceId,
    protocol: 'gt06',
    deviceTime: haMin(1),
    fixTime: haMin(1),
    serverTime: haMin(1),
    outdated: false,
    valid: true,
    latitude: -22.9,
    longitude: -43.2,
    altitude: 0,
    speed: 30,
    course: 90,
    address: 'Rua A, 1',
    accuracy: 0,
    attributes: { ignition: true, sat: 9 },
    ...extra,
  };
}

beforeEach(() => {
  jest.useFakeTimers({ now: AGORA });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('derivarLinha', () => {
  it('veículo andando, online, com device e posição', () => {
    const v = veiculo('1');
    const linha = derivarLinha(v, device(1), posicao(1), 0);
    expect(linha).toEqual({
      ...v,
      vehicleType: 'CAR',
      latitude: -22.9,
      longitude: -43.2,
      speed: 30,
      course: 90,
      address: 'Rua A, 1',
      lastUpdate: haMin(1),
      positionTime: haMin(1),
      deviceStatus: 'online',
      displayStatus: 'online',
      ignition: true,
      moving: true,
      satellites: 9,
    });
  });

  it('sem device: lastUpdate cai no serverTime da posição; 45 min = S/RESP, sem movimento por posição velha', () => {
    const v = veiculo('2');
    const p = posicao(2, {
      fixTime: haMin(45),
      deviceTime: haMin(45),
      serverTime: haMin(45),
      address: undefined as unknown as string,
      attributes: {},
    });
    const linha = derivarLinha(v, undefined, p, 0);
    expect(linha.lastUpdate).toBe(haMin(45));
    expect(linha.positionTime).toBe(haMin(45));
    expect(linha.deviceStatus).toBe('offline');
    expect(linha.displayStatus).toBe('sem_resp');
    expect(linha.moving).toBe(false);
    expect(linha.ignition).toBe(false);
    expect(linha.satellites).toBe(0);
    expect(linha.address).toBe('');
  });

  it('sem rastreador e sem vehicleType: CAR por padrão, sem posição = offline e zeros', () => {
    const v = veiculo('3', {
      traccarDeviceId: null,
      vehicleType: undefined as unknown as Vehicle['vehicleType'],
    });
    const linha = derivarLinha(v, undefined, undefined, 0);
    expect(linha).toEqual({
      ...v,
      vehicleType: 'CAR',
      latitude: 0,
      longitude: 0,
      speed: 0,
      course: 0,
      address: '',
      lastUpdate: '',
      positionTime: null,
      deviceStatus: 'offline',
      displayStatus: 'offline',
      ignition: false,
      moving: false,
      satellites: 0,
    });
  });

  it('BLOCKED vira alert e device.lastUpdate tem prioridade sobre serverTime', () => {
    const v = veiculo('4', { status: 'BLOCKED' });
    const linha = derivarLinha(v, device(4, { lastUpdate: haMin(2) }), posicao(4, { serverTime: haMin(9) }), 0);
    expect(linha.lastUpdate).toBe(haMin(2));
    expect(linha.displayStatus).toBe('alert');
  });
});

describe('criarCacheLinhas', () => {
  it('mesma referência quando as quatro entradas são idênticas', () => {
    const cache = criarCacheLinhas();
    const v = veiculo('1');
    const d = device(1);
    const p = posicao(1);
    const a = cache.obter(v, d, p, 0);
    const b = cache.obter(v, d, p, 0);
    expect(b).toBe(a);
    expect(cache.recalculos).toBe(1);
  });

  it('referência nova quando a posição muda', () => {
    const cache = criarCacheLinhas();
    const v = veiculo('1');
    const d = device(1);
    const a = cache.obter(v, d, posicao(1), 0);
    const b = cache.obter(v, d, posicao(1, { speed: 0 }), 0);
    expect(b).not.toBe(a);
    expect(b.speed).toBe(0);
    expect(cache.recalculos).toBe(2);
  });

  it('minuto novo recalcula todos e reflete o tempo que passou', () => {
    const cache = criarCacheLinhas();
    const vs = ['1', '2', '3'].map((id) => veiculo(id));
    const ds = vs.map((v) => device(v.traccarDeviceId!));
    const ps = vs.map((v) => posicao(v.traccarDeviceId!));
    const antes = vs.map((v, i) => cache.obter(v, ds[i], ps[i], 0));
    expect(antes[0].displayStatus).toBe('online');
    jest.setSystemTime(AGORA + 40 * 60_000);
    const mesmoMinuto = vs.map((v, i) => cache.obter(v, ds[i], ps[i], 0));
    mesmoMinuto.forEach((l, i) => expect(l).toBe(antes[i]));
    const depois = vs.map((v, i) => cache.obter(v, ds[i], ps[i], 1));
    depois.forEach((l, i) => expect(l).not.toBe(antes[i]));
    expect(depois[0].displayStatus).toBe('sem_resp');
    expect(cache.recalculos).toBe(6);
  });

  it('podar remove quem saiu do vehicleMap', () => {
    const cache = criarCacheLinhas();
    const v1 = veiculo('1');
    const v2 = veiculo('2');
    cache.obter(v1, undefined, undefined, 0);
    cache.obter(v2, undefined, undefined, 0);
    expect(cache.tamanho).toBe(2);
    cache.podar(new Map([[v1.id, v1]]));
    expect(cache.tamanho).toBe(1);
    const a = cache.obter(v1, undefined, undefined, 0);
    expect(cache.recalculos).toBe(2);
    expect(cache.obter(v1, undefined, undefined, 0)).toBe(a);
  });

  it('7.000 veículos e lote de 500 posições: exatamente 500 recálculos', () => {
    const cache = criarCacheLinhas();
    const vs: Vehicle[] = [];
    const ds = new Map<number, TraccarDevice>();
    const ps = new Map<number, TraccarPosition>();
    for (let i = 1; i <= 7000; i++) {
      vs.push(veiculo(String(i)));
      ds.set(i, device(i));
      ps.set(i, posicao(i));
    }
    const rodada = () =>
      vs.map((v) => cache.obter(v, ds.get(v.traccarDeviceId!), ps.get(v.traccarDeviceId!), 0));
    rodada();
    expect(cache.recalculos).toBe(7000);
    for (let i = 1; i <= 500; i++) ps.set(i * 7, posicao(i * 7, { speed: 50 }));
    rodada();
    expect(cache.recalculos).toBe(7500);
  });
});
