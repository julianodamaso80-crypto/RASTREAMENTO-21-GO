import type { TraccarDevice, TraccarPosition } from '@/types/traccar';
import {
  aplicarAtributos,
  decidirPolling,
  criarSequencia,
  devePedirFrotaHttp,
  mesclarDevices,
  mesclarPosicoes,
  POLL_MS,
  RECONCILIA_MS,
  SOCKET_MUDO_MS,
  VEHICLES_CONTINGENCIA_MS,
  VEHICLES_MS,
  type EstadoPolling,
  type PosicaoComAtributos,
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
    recebeEventos: true,
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

  it('contingência com socket fora recarrega vehicles a cada 32 s, com folga de meio tique', () => {
    const limite = VEHICLES_MS - POLL_MS / 2;
    const v = (ultimosVehiclesEm: number) =>
      decidirPolling(estado({ socketConectado: false, ultimosVehiclesEm })).vehicles;
    expect(v(AGORA - VEHICLES_MS)).toBe(true);
    expect(v(AGORA - limite)).toBe(true);
    expect(v(AGORA - limite + 1)).toBe(false);
  });

  it('contingência com socket fora e jitter: vehicles há 31.900 ms dispara', () => {
    expect(
      decidirPolling(estado({ socketConectado: false, ultimosVehiclesEm: AGORA - 31_900 })).vehicles,
    ).toBe(true);
  });

  it('contingência com socket mudo mantém os 32 s (o vehicles:changed não chega)', () => {
    const mudo = { ultimoLoteEm: AGORA - SOCKET_MUDO_MS - 1 };
    expect(decidirPolling(estado({ ...mudo, ultimosVehiclesEm: AGORA - VEHICLES_MS })).vehicles).toBe(true);
    expect(decidirPolling(estado({ ...mudo, ultimosVehiclesEm: AGORA - 10_000 })).vehicles).toBe(false);
  });

  it('contingência com socket ok não recarrega vehicles aos 32 s, só aos 5 min', () => {
    expect(VEHICLES_CONTINGENCIA_MS).toBe(300_000);
    const v = (ultimosVehiclesEm: number) => decidirPolling(estado({ ultimosVehiclesEm })).vehicles;
    expect(v(AGORA - VEHICLES_MS)).toBe(false);
    expect(v(AGORA - 120_000)).toBe(false);
    expect(v(AGORA - VEHICLES_CONTINGENCIA_MS)).toBe(true);
    expect(v(AGORA - VEHICLES_CONTINGENCIA_MS + POLL_MS / 2)).toBe(true);
    expect(v(AGORA - VEHICLES_CONTINGENCIA_MS + POLL_MS / 2 + 1)).toBe(false);
  });

  it('contingência com socket ok mas sem receber eventos (CLIENT) mantém os 32 s', () => {
    const v = (ultimosVehiclesEm: number, recebeEventos: boolean) =>
      decidirPolling(estado({ ultimosVehiclesEm, recebeEventos })).vehicles;
    expect(v(AGORA - VEHICLES_MS, false)).toBe(true);
    expect(v(AGORA - 10_000, false)).toBe(false);
    expect(v(AGORA - VEHICLES_MS, true)).toBe(false);
    expect(v(AGORA - VEHICLES_CONTINGENCIA_MS, true)).toBe(true);
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

  it('contingência com socket vivo recarrega vehicles no prazo de 5 min, sem frota', () => {
    const d = decidirPolling(estado({ ultimosVehiclesEm: AGORA - VEHICLES_CONTINGENCIA_MS }));
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

describe('aplicarAtributos', () => {
  const T0 = '2026-10-14T12:00:00.000Z';
  const T1 = '2026-10-14T12:00:10.000Z';

  it('mescla a ignição sem mexer em coordenada, fix, velocidade nem rumo', () => {
    const antes = pos(1, T0, { speed: 40, course: 90, attributes: { ignition: false, odometer: 5 } });
    const prev = new Map([[1, antes]]);
    const r = aplicarAtributos(prev, [{ deviceId: 1, serverTime: T1, attributes: { ignition: true } }]);
    const depois = r.get(1)!;
    expect(depois).not.toBe(antes);
    expect(depois.attributes).toEqual({ ignition: true, odometer: 5 });
    // serverTime continua o da posição; o horário dos atributos vai à parte.
    expect(depois.serverTime).toBe(T0);
    expect((depois as PosicaoComAtributos).attributesServerTime).toBe(T1);
    expect(depois.latitude).toBe(antes.latitude);
    expect(depois.longitude).toBe(antes.longitude);
    expect(depois.fixTime).toBe(antes.fixTime);
    expect(depois.deviceTime).toBe(antes.deviceTime);
    expect(depois.speed).toBe(40);
    expect(depois.course).toBe(90);
    // O objeto anterior não é mutado.
    expect(antes.attributes).toEqual({ ignition: false, odometer: 5 });
  });

  it('item mais velho que a posição exibida é ignorado', () => {
    const antes = pos(1, T1, { attributes: { ignition: true } });
    const prev = new Map([[1, antes]]);
    const r = aplicarAtributos(prev, [{ deviceId: 1, serverTime: T0, attributes: { ignition: false } }]);
    expect(r.get(1)).toBe(antes);
  });

  it('device sem posição não ganha entrada (não há coordenada para mostrar)', () => {
    const prev = new Map([[1, pos(1, T0)]]);
    const r = aplicarAtributos(prev, [{ deviceId: 2, serverTime: T1, attributes: { ignition: true } }]);
    expect(r.has(2)).toBe(false);
    expect(r.size).toBe(1);
  });

  it('descarta chave fora da lista branca, inclusive coordenada', () => {
    const prev = new Map([[1, pos(1, T0, { attributes: {} })]]);
    const r = aplicarAtributos(prev, [
      {
        deviceId: 1,
        serverTime: T1,
        attributes: { ignition: true, latitude: 0, odometer: 9, power: 12.1 },
      },
    ]);
    expect(r.get(1)!.attributes).toEqual({ ignition: true, power: 12.1 });
    expect(r.get(1)!.latitude).toBe(-22.9);
  });

  it('itens do mesmo lote se aplicam em ordem', () => {
    const prev = new Map([[1, pos(1, T0, { attributes: {} })]]);
    const r = aplicarAtributos(prev, [
      { deviceId: 1, serverTime: '2026-10-14T12:00:05.000Z', attributes: { ignition: true } },
      { deviceId: 1, serverTime: T1, attributes: { ignition: false } },
    ]);
    expect(r.get(1)!.attributes.ignition).toBe(false);
    expect((r.get(1) as PosicaoComAtributos).attributesServerTime).toBe(T1);
  });

  it('atributo mais velho que o último atributo aplicado é ignorado', () => {
    const prev = new Map([[1, pos(1, T0, { attributes: {} })]]);
    const um = aplicarAtributos(prev, [{ deviceId: 1, serverTime: T1, attributes: { ignition: true } }]);
    const dois = aplicarAtributos(um, [
      { deviceId: 1, serverTime: '2026-10-14T12:00:05.000Z', attributes: { ignition: false } },
    ]);
    expect(dois).toBe(um);
    expect(dois.get(1)!.attributes.ignition).toBe(true);
  });

  it('snapshot REST com fix mais novo vence a posição exibida com atributos mais novos', () => {
    // fix exibido T1 < fix do REST T2 < atributos T3 (o socket perdeu a posição T2).
    const P1 = '2026-10-14T12:00:01.000Z';
    const P2 = '2026-10-14T12:00:02.000Z';
    const A3 = '2026-10-14T12:00:03.000Z';
    const prev = new Map([[1, pos(1, P1, { latitude: -22.9, attributes: { ignition: false } })]]);
    const exibida = aplicarAtributos(prev, [{ deviceId: 1, serverTime: A3, attributes: { ignition: true } }]);
    const rest = pos(1, P2, { id: 2, latitude: -22.8, attributes: { ignition: false } });
    const r = mesclarPosicoes(exibida, [rest]);
    expect(r.get(1)).toBe(rest);
    expect(r.get(1)!.latitude).toBe(-22.8);
    // Os atributos de T3 não são reaplicados sobre o REST: o próximo attrs:batch
    // (ou a próxima posição do socket) traz o estado atual da ignição.
    expect(r.get(1)!.attributes.ignition).toBe(false);
  });

  it('lote sem nada aplicável devolve o mesmo Map (sem render à toa)', () => {
    const prev = new Map([[1, pos(1, T0)]]);
    expect(aplicarAtributos(prev, [{ deviceId: 9, serverTime: T1, attributes: { ignition: true } }])).toBe(prev);
  });
});

describe('devePedirFrotaHttp', () => {
  it('CLIENT não pede /traccar/*; os demais papéis pedem', () => {
    expect(devePedirFrotaHttp('CLIENT')).toBe(false);
    for (const r of ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER', undefined]) {
      expect(devePedirFrotaHttp(r)).toBe(true);
    }
  });
});

describe('criarSequencia', () => {
  it('só a carga mais nova já aplicada vale; resposta atrasada é descartada', () => {
    const seq = criarSequencia();
    const a = seq.proximo();
    const b = seq.proximo();
    expect(b).toBeGreaterThan(a);
    // b (iniciada depois) responde primeiro e é aplicada.
    expect(seq.aplicavel(b)).toBe(true);
    // a responde atrasada: mais velha que a última aplicada.
    expect(seq.aplicavel(a)).toBe(false);
    // repetir a mesma aplicada não regride nada.
    expect(seq.aplicavel(b)).toBe(true);
  });

  it('ordem normal aplica todas', () => {
    const seq = criarSequencia();
    const a = seq.proximo();
    expect(seq.aplicavel(a)).toBe(true);
    const b = seq.proximo();
    expect(seq.aplicavel(b)).toBe(true);
  });
});
