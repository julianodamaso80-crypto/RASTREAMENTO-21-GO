import type { TraccarDevice, TraccarPosition } from '@/types/traccar';
import {
  decidirPolling,
  mesclarDevices,
  mesclarPosicoes,
  POLL_MS,
  RECONCILIA_MS,
  SOCKET_MUDO_MS,
  VEHICLES_MS,
  type EstadoPolling,
} from './tracking-polling';

const AGORA = 1_000_000_000;

function estado(parcial: Partial<EstadoPolling>): EstadoPolling {
  return {
    modo: 'contingencia',
    agora: AGORA,
    tique: 1,
    socketConectado: true,
    ultimoLoteEm: AGORA - 1_000,
    ultimaFrotaEm: AGORA - 10_000,
    ultimosVehiclesEm: AGORA - 10_000,
    ...parcial,
  };
}

function pos(deviceId: number, serverTime: string, extra: Partial<TraccarPosition> = {}): TraccarPosition {
  return {
    id: 1,
    deviceId,
    protocol: 'gt06',
    deviceTime: serverTime,
    fixTime: serverTime,
    serverTime,
    outdated: false,
    valid: true,
    latitude: -22.9,
    longitude: -43.2,
    altitude: 0,
    speed: 0,
    course: 0,
    address: '',
    accuracy: 0,
    attributes: {},
    ...extra,
  };
}

function dev(id: number, lastUpdate: string, extra: Partial<TraccarDevice> = {}): TraccarDevice {
  return {
    id,
    name: `d${id}`,
    uniqueId: String(id),
    status: 'online',
    lastUpdate,
    positionId: 0,
    groupId: 0,
    phone: '',
    model: '',
    contact: '',
    category: '',
    disabled: false,
    attributes: {},
    ...extra,
  };
}

describe('decidirPolling', () => {
  it('legado busca a frota em todo tique, mesmo com socket vivo e lote recente', () => {
    const d = decidirPolling(estado({ modo: 'legado', ultimaFrotaEm: AGORA - 1 }));
    expect(d.frota).toBe(true);
    expect(d.motivo).toBe('legado');
  });

  it('legado busca a frota mesmo com socket fora', () => {
    const d = decidirPolling(estado({ modo: 'legado', socketConectado: false }));
    expect(d.frota).toBe(true);
    expect(d.motivo).toBe('legado');
  });

  it('contingência com socket conectado, lote há 1 s e frota há 10 s não busca nada', () => {
    const d = decidirPolling(estado({}));
    expect(d).toEqual({ frota: false, vehicles: false, motivo: 'nada' });
  });

  it('contingência com socket fora busca a frota', () => {
    const d = decidirPolling(estado({ socketConectado: false }));
    expect(d.frota).toBe(true);
    expect(d.motivo).toBe('socket-fora');
  });

  it('contingência com socket conectado mas sem lote há 91 s trata como mudo', () => {
    const d = decidirPolling(estado({ ultimoLoteEm: AGORA - 91_000 }));
    expect(d.frota).toBe(true);
    expect(d.motivo).toBe('socket-mudo');
  });

  it('contingência no limite exato do socket mudo ainda não busca', () => {
    const d = decidirPolling(estado({ ultimoLoteEm: AGORA - SOCKET_MUDO_MS }));
    expect(d.frota).toBe(false);
  });

  it('contingência sem nenhum lote ainda (null) não conta como mudo', () => {
    const d = decidirPolling(estado({ ultimoLoteEm: null }));
    expect(d.frota).toBe(false);
    expect(d.motivo).toBe('nada');
  });

  it('contingência reconcilia a frota inteira a cada 60 s com socket vivo (folga de meio tique)', () => {
    const d = decidirPolling(estado({ ultimaFrotaEm: AGORA - 61_000 }));
    expect(d.frota).toBe(true);
    expect(d.motivo).toBe('reconciliacao');
    const limite = RECONCILIA_MS - POLL_MS / 2;
    expect(decidirPolling(estado({ ultimaFrotaEm: AGORA - limite })).frota).toBe(true);
    expect(decidirPolling(estado({ ultimaFrotaEm: AGORA - limite + 1 })).frota).toBe(false);
  });

  it('contingência com jitter: reconciliação a 59.900 ms dispara no tique dos 60 s', () => {
    expect(decidirPolling(estado({ ultimaFrotaEm: AGORA - 59_900 })).motivo).toBe('reconciliacao');
  });

  it('contingência recarrega vehicles a cada 32 s, com folga de meio tique', () => {
    const limite = VEHICLES_MS - POLL_MS / 2;
    expect(decidirPolling(estado({ ultimosVehiclesEm: AGORA - VEHICLES_MS })).vehicles).toBe(true);
    expect(decidirPolling(estado({ ultimosVehiclesEm: AGORA - limite })).vehicles).toBe(true);
    expect(decidirPolling(estado({ ultimosVehiclesEm: AGORA - limite + 1 })).vehicles).toBe(false);
  });

  it('contingência com jitter: vehicles há 31.900 ms dispara (não escorrega para o 5º tique)', () => {
    expect(decidirPolling(estado({ ultimosVehiclesEm: AGORA - 31_900 })).vehicles).toBe(true);
  });

  it('legado recarrega vehicles a cada 4 tiques, independentemente do relógio', () => {
    const legado = (tique: number, ultimosVehiclesEm: number) =>
      decidirPolling(estado({ modo: 'legado', tique, ultimosVehiclesEm })).vehicles;
    expect(legado(4, AGORA)).toBe(true);
    expect(legado(8, AGORA - 1)).toBe(true);
    expect(legado(4, AGORA - 31_900)).toBe(true);
    expect(legado(3, AGORA - 100_000)).toBe(false);
    expect(legado(5, AGORA - 100_000)).toBe(false);
  });

  it('contingência com socket vivo ainda recarrega vehicles no prazo, sem frota', () => {
    const d = decidirPolling(estado({ ultimosVehiclesEm: AGORA - VEHICLES_MS }));
    expect(d).toEqual({ frota: false, vehicles: true, motivo: 'nada' });
  });
});

describe('mesclarPosicoes', () => {
  it('fica com a mais nova por deviceId e remove quem saiu da resposta', () => {
    const anterior = new Map<number, TraccarPosition>([
      [1, pos(1, '2026-10-13T12:00:10.000Z')], // websocket mais novo que o HTTP
      [2, pos(2, '2026-10-13T12:00:00.000Z')],
      [3, pos(3, '2026-10-13T12:00:00.000Z')], // saiu (desvinculado)
    ]);
    const novas = [
      pos(1, '2026-10-13T12:00:05.000Z'),
      pos(2, '2026-10-13T12:00:07.000Z'),
      pos(4, '2026-10-13T12:00:01.000Z'),
    ];
    const r = mesclarPosicoes(anterior, novas);
    expect([...r.keys()].sort()).toEqual([1, 2, 4]);
    expect(r.get(1)!.serverTime).toBe('2026-10-13T12:00:10.000Z');
    expect(r.get(2)!.serverTime).toBe('2026-10-13T12:00:07.000Z');
    expect(r.get(4)).toBe(novas[2]);
  });

  it('com o mesmo dado dos dois lados equivale a trocar o mapa (semântica de hoje)', () => {
    const novas = [pos(1, '2026-10-13T12:00:05.000Z'), pos(2, '2026-10-13T12:00:07.000Z')];
    const anterior = new Map(novas.map((p) => [p.deviceId, { ...p }]));
    const r = mesclarPosicoes(anterior, novas);
    const hoje = new Map(novas.map((p) => [p.deviceId, p]));
    expect([...r.keys()]).toEqual([...hoje.keys()]);
    expect(r.get(1)).toEqual(hoje.get(1));
    expect(r.get(2)).toEqual(hoje.get(2));
  });

  it('desempata por fixTime e depois por id quando serverTime falta', () => {
    const anterior = new Map<number, TraccarPosition>([
      [1, pos(1, '', { fixTime: '2026-10-13T12:00:09.000Z' })],
      [2, pos(2, '', { fixTime: '', id: 50 })],
    ]);
    const r = mesclarPosicoes(anterior, [
      pos(1, '', { fixTime: '2026-10-13T12:00:03.000Z' }),
      pos(2, '', { fixTime: '', id: 70 }),
    ]);
    expect(r.get(1)!.fixTime).toBe('2026-10-13T12:00:09.000Z');
    expect(r.get(2)!.id).toBe(70);
  });

  it('sem nada antes devolve exatamente a resposta', () => {
    const novas = [pos(1, '2026-10-13T12:00:05.000Z')];
    const r = mesclarPosicoes(new Map(), novas);
    expect(r.size).toBe(1);
    expect(r.get(1)).toBe(novas[0]);
  });
});

describe('mesclarDevices', () => {
  it('fica com o lastUpdate mais novo e remove quem saiu da resposta', () => {
    const anterior = new Map<number, TraccarDevice>([
      [1, dev(1, '2026-10-13T12:00:10.000Z', { status: 'online' })],
      [2, dev(2, '2026-10-13T12:00:00.000Z')],
      [3, dev(3, '2026-10-13T12:00:00.000Z')],
    ]);
    const novos = [
      dev(1, '2026-10-13T12:00:05.000Z', { status: 'offline' }),
      dev(2, '2026-10-13T12:00:07.000Z'),
    ];
    const r = mesclarDevices(anterior, novos);
    expect([...r.keys()].sort()).toEqual([1, 2]);
    expect(r.get(1)!.status).toBe('online');
    expect(r.get(2)!.lastUpdate).toBe('2026-10-13T12:00:07.000Z');
  });

  it('com o mesmo dado dos dois lados equivale a trocar o mapa', () => {
    const novos = [dev(1, '2026-10-13T12:00:05.000Z'), dev(2, '2026-10-13T12:00:07.000Z')];
    const r = mesclarDevices(new Map(novos.map((d) => [d.id, { ...d }])), novos);
    expect([...r.keys()]).toEqual([1, 2]);
    expect(r.get(1)).toEqual(novos[0]);
    expect(r.get(2)).toEqual(novos[1]);
  });
});
