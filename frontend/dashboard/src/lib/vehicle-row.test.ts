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
    const linha = derivarLinha(v, device(1), posicao(1));
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
    const linha = derivarLinha(v, undefined, p);
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
    const linha = derivarLinha(v, undefined, undefined);
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
    const linha = derivarLinha(v, device(4, { lastUpdate: haMin(2) }), posicao(4, { serverTime: haMin(9) }));
    expect(linha.lastUpdate).toBe(haMin(2));
    expect(linha.displayStatus).toBe('alert');
  });
});

describe('criarCacheLinhas', () => {
  it('mesma referência quando as três entradas são idênticas e nada venceu', () => {
    const cache = criarCacheLinhas();
    const v = veiculo('1');
    const d = device(1);
    const p = posicao(1);
    const a = cache.obter(v, d, p, AGORA);
    const b = cache.obter(v, d, p, AGORA + 1_000);
    expect(b).toBe(a);
    expect(cache.recalculos).toBe(1);
  });

  it('referência nova quando a posição muda', () => {
    const cache = criarCacheLinhas();
    const v = veiculo('1');
    const d = device(1);
    const a = cache.obter(v, d, posicao(1), AGORA);
    const b = cache.obter(v, d, posicao(1, { speed: 0 }), AGORA);
    expect(b).not.toBe(a);
    expect(b.speed).toBe(0);
    expect(cache.recalculos).toBe(2);
  });

  it('posição de 2 min 59 s não recalcula; aos 3 min 01 s recalcula e moving vira false', () => {
    const cache = criarCacheLinhas();
    const v = veiculo('1');
    const d = device(1, { lastUpdate: haMin(0) });
    const p = posicao(1, { fixTime: haMin(0), deviceTime: haMin(0), serverTime: haMin(0) });
    const a = cache.obter(v, d, p, AGORA);
    expect(a.moving).toBe(true);
    jest.setSystemTime(AGORA + 179_000);
    expect(cache.venceuAlguma(Date.now())).toBe(false);
    expect(cache.obter(v, d, p, Date.now())).toBe(a);
    jest.setSystemTime(AGORA + 181_000);
    expect(cache.venceuAlguma(Date.now())).toBe(true);
    const b = cache.obter(v, d, p, Date.now());
    expect(b).not.toBe(a);
    expect(b.moving).toBe(false);
    expect(b.displayStatus).toBe('online');
    expect(cache.recalculos).toBe(2);
  });

  it('vira S/RESP no instante dos 30 min, sem esperar minuto', () => {
    const cache = criarCacheLinhas();
    const v = veiculo('1');
    const d = device(1, { lastUpdate: haMin(10) });
    const p = posicao(1, { fixTime: haMin(10), deviceTime: haMin(10), serverTime: haMin(10) });
    const a = cache.obter(v, d, p, AGORA);
    expect(a.displayStatus).toBe('online');
    const vence = cache.proximoVencimento()!;
    expect(vence).toBe(AGORA + 20 * 60_000 + 1);
    jest.setSystemTime(vence - 1);
    expect(cache.obter(v, d, p, Date.now())).toBe(a);
    jest.setSystemTime(vence);
    expect(cache.obter(v, d, p, Date.now()).displayStatus).toBe('sem_resp');
  });

  it('podar remove quem saiu do vehicleMap', () => {
    const cache = criarCacheLinhas();
    const v1 = veiculo('1');
    const v2 = veiculo('2');
    cache.obter(v1, undefined, undefined, AGORA);
    cache.obter(v2, undefined, undefined, AGORA);
    expect(cache.tamanho).toBe(2);
    cache.podar(new Map([[v1.id, v1]]));
    expect(cache.tamanho).toBe(1);
    const a = cache.obter(v1, undefined, undefined, AGORA);
    expect(cache.recalculos).toBe(2);
    expect(cache.obter(v1, undefined, undefined, AGORA)).toBe(a);
  });

  it('7.000 veículos: lote de 500 posições = 500 recálculos; tique sem vencimento = 0 e sem render', () => {
    const cache = criarCacheLinhas();
    const vs: Vehicle[] = [];
    const ds = new Map<number, TraccarDevice>();
    const ps = new Map<number, TraccarPosition>();
    for (let i = 1; i <= 7000; i++) {
      vs.push(veiculo(String(i)));
      ds.set(i, device(i));
      ps.set(i, posicao(i));
    }
    const rodada = (agora: number) =>
      vs.map((v) => cache.obter(v, ds.get(v.traccarDeviceId!), ps.get(v.traccarDeviceId!), agora));
    rodada(AGORA);
    expect(cache.recalculos).toBe(7000);
    for (let i = 1; i <= 500; i++) ps.set(i * 7, posicao(i * 7, { speed: 50 }));
    rodada(AGORA);
    expect(cache.recalculos).toBe(7500);
    // Tique de 1 s: a posição tem 1 min e só vence aos 3 — nada a renderizar.
    expect(cache.venceuAlguma(AGORA + 1_000)).toBe(false);
    rodada(AGORA + 1_000);
    expect(cache.recalculos).toBe(7500);
    // Aos 2 min + 1 s a posição de todos passou de 3 min: o tique pede render.
    expect(cache.venceuAlguma(AGORA + 121_000)).toBe(true);
  });
});
