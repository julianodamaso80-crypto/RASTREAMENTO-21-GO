import { TraccarGateway } from './traccar.gateway';

/**
 * Pacote sem fix (heartbeat/status do GT06, LBS) é reprovado pelo portão de
 * qualidade e a coordenada nunca vai pro mapa. Mas a ignição, a energia e o
 * bloqueio que vêm nele são verdadeiros: sem `attrs:batch`, o painel só os via
 * na reconciliação (56–64 s).
 */

function posicao(deviceId: number, extra: Record<string, unknown> = {}) {
  const agora = new Date().toISOString();
  return {
    deviceId,
    latitude: -22.9,
    longitude: -43.55,
    speed: 30,
    course: 90,
    valid: true,
    outdated: false,
    accuracy: 8,
    attributes: {},
    fixTime: agora,
    deviceTime: agora,
    serverTime: agora,
    ...extra,
  };
}

function montar() {
  const emit = jest.fn();
  const to = jest.fn((_sala: string) => ({ emit }));
  const setRefresher = jest.fn();
  const gateway = new TraccarGateway(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { setEmitter: jest.fn() } as any,
    { setEmitter: jest.fn() } as any,
    {} as any,
    { setRefresher } as any,
  );
  gateway.server = { to } as any;
  const interno = gateway as unknown as {
    deviceTenantMap: Map<number, string>;
    deviceAssociateMap: Map<number, string>;
    handleTraccarMessage: (m: { positions?: unknown[] }) => void;
  };
  interno.deviceTenantMap.set(1, 'tenant-a');
  interno.deviceTenantMap.set(3, 'tenant-b');
  interno.deviceAssociateMap.set(1, 'assoc-x');
  return { gateway, interno, to, emit, setRefresher };
}

const lotes = (emit: jest.Mock, evento: string) =>
  emit.mock.calls.filter((c) => c[0] === evento);

describe('TraccarGateway — atributos de posição reprovada (attrs:batch)', () => {
  it('posição sem fix com ignição vira attrs:batch do tenant, só com a lista branca', () => {
    const { gateway, interno, to, emit } = montar();
    const reprovada = posicao(1, {
      valid: false,
      deviceTime: '2026-10-14T12:00:04.000Z',
      serverTime: '2026-10-14T12:00:05.000Z',
      attributes: {
        ignition: true,
        power: 12.6,
        charge: true,
        blocked: false,
        batteryLevel: 80,
        sat: 0,
        motion: false,
        powerCut: false,
        jamming: false,
        alarm: 'sos',
        odometer: 123456,
        rssi: 4,
        latitude: -1,
      },
    });

    interno.handleTraccarMessage({ positions: [reprovada] });
    gateway.flushPositionsBatch();

    expect(to).toHaveBeenCalledWith('tenant:tenant-a');
    expect(lotes(emit, 'positions:batch')).toHaveLength(0);
    const attrs = lotes(emit, 'attrs:batch');
    expect(attrs).toHaveLength(1);
    expect(attrs[0][1]).toEqual([
      {
        deviceId: 1,
        serverTime: '2026-10-14T12:00:05.000Z',
        attributes: {
          ignition: true,
          power: 12.6,
          charge: true,
          blocked: false,
          batteryLevel: 80,
          sat: 0,
          motion: false,
          powerCut: false,
          jamming: false,
          alarm: 'sos',
        },
      },
    ]);
    // Nenhuma coordenada, velocidade ou rumo sai no item.
    const item = attrs[0][1][0] as Record<string, unknown>;
    expect(Object.keys(item).sort()).toEqual(['attributes', 'deviceId', 'serverTime']);
  });

  it('o app do associado não recebe nada da posição reprovada', () => {
    const { gateway, interno, emit } = montar();
    interno.handleTraccarMessage({
      positions: [posicao(1, { outdated: true, attributes: { ignition: true } })],
    });
    gateway.flushPositionsBatch();
    expect(emit).not.toHaveBeenCalledWith('position:update', expect.anything());
  });

  it('posição aprovada segue em positions:batch e não gera attrs:batch', () => {
    const { gateway, interno, emit } = montar();
    interno.handleTraccarMessage({
      positions: [posicao(1, { attributes: { ignition: true } })],
    });
    gateway.flushPositionsBatch();
    expect(lotes(emit, 'positions:batch')).toHaveLength(1);
    expect(lotes(emit, 'attrs:batch')).toHaveLength(0);
  });

  it('device desconhecido (sem tenant no mapping) não emite nada', () => {
    const { gateway, interno, emit } = montar();
    interno.handleTraccarMessage({
      positions: [posicao(99, { valid: false, attributes: { ignition: true } })],
    });
    gateway.flushPositionsBatch();
    expect(emit).not.toHaveBeenCalled();
  });

  it('cada tenant recebe só os próprios devices', () => {
    const { gateway, interno, to, emit } = montar();
    interno.handleTraccarMessage({
      positions: [
        posicao(1, { valid: false, attributes: { ignition: true } }),
        posicao(3, { valid: false, attributes: { ignition: false } }),
      ],
    });
    gateway.flushPositionsBatch();
    const attrs = lotes(emit, 'attrs:batch');
    expect(attrs).toHaveLength(2);
    const destinos = to.mock.calls.map((c) => c[0]);
    expect(destinos).toEqual(['tenant:tenant-a', 'tenant:tenant-b']);
    expect((attrs[0][1] as Array<{ deviceId: number }>).map((i) => i.deviceId)).toEqual([1]);
    expect((attrs[1][1] as Array<{ deviceId: number }>).map((i) => i.deviceId)).toEqual([3]);
  });

  it('posição reprovada sem nenhum atributo da lista não gera item', () => {
    const { gateway, interno, emit } = montar();
    interno.handleTraccarMessage({
      positions: [posicao(1, { valid: false, attributes: { odometer: 10 } })],
    });
    gateway.flushPositionsBatch();
    expect(emit).not.toHaveBeenCalled();
  });

  it('pacote da memória do rastreador (deviceTime antigo) não vira estado atual', () => {
    const { gateway, interno, emit } = montar();
    interno.handleTraccarMessage({
      positions: [
        posicao(1, {
          valid: false,
          deviceTime: '2026-10-14T10:00:00.000Z',
          serverTime: '2026-10-14T12:00:00.000Z',
          attributes: { ignition: true },
        }),
      ],
    });
    gateway.flushPositionsBatch();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('TraccarGateway — refresh do mapping após vínculo', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function preparar() {
    const { gateway, setRefresher } = montar();
    const refresh = jest
      .spyOn(gateway, 'refreshDeviceMapping')
      .mockResolvedValue(undefined);
    (gateway as unknown as { connectToTraccar: () => void }).connectToTraccar = jest.fn();
    await gateway.afterInit();
    refresh.mockClear();
    const refresher = setRefresher.mock.calls[0][0] as () => Promise<void>;
    return { refresh, refresher };
  }

  it('vínculo isolado atualiza o mapping na hora, como antes', async () => {
    const { refresh, refresher } = await preparar();
    void refresher();
    expect(refresh).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('rajada de N vínculos em 1 s vira no máximo 2 consultas', async () => {
    const { refresh, refresher } = await preparar();
    let resolvidos = 0;
    for (let i = 0; i < 5; i++) void refresher().then(() => resolvidos++);
    expect(refresh).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(resolvidos).toBe(5);

    // Depois de a janela fechar sem avisos, o próximo volta a ser imediato.
    await jest.advanceTimersByTimeAsync(1_000);
    void refresher();
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});
