import { TraccarGateway } from './traccar.gateway';
import { DeviceRegistryService } from './device-registry.service';

describe('DeviceRegistryService.onChanged', () => {
  it('avisa os ouvintes a cada notifyDeviceChanged, mesmo sem refresher', () => {
    const registry = new DeviceRegistryService();
    const cb = jest.fn();
    registry.onChanged(cb);
    registry.notifyDeviceChanged('a');
    registry.notifyDeviceChanged('b');
    expect(cb).toHaveBeenNthCalledWith(1, null, 'a');
    expect(cb).toHaveBeenNthCalledWith(2, null, 'b');
  });

  it('ouvinte que lança não derruba a notificação', () => {
    const registry = new DeviceRegistryService();
    registry.onChanged(() => {
      throw new Error('x');
    });
    expect(() => registry.notifyDeviceChanged('a')).not.toThrow();
  });
});

describe('TraccarGateway — vehicles:changed', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function montar() {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const registry = new DeviceRegistryService();
    const gateway = new TraccarGateway(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      registry,
    );
    // Com namespace o Nest injeta um Namespace: `adapter` direto, sem `sockets.adapter`.
    gateway.server = {
      to,
      sockets: new Map(),
      adapter: {
        rooms: new Map([
          ['tenant:a', new Set(['s1'])],
          ['tenant:b', new Set(['s2'])],
          ['associate:x', new Set(['s3'])],
          ['s1', new Set(['s1'])],
        ]),
      },
    } as any;
    (gateway as any).registrarOuvinteVehicles();
    return { registry, to, emit };
  }

  it('3 notificações do tenant A em 2 s viram 1 emit só para tenant:a, sem motivo', () => {
    const { registry, to, emit } = montar();
    registry.notifyDeviceChanged('placa ABC1234', 'a');
    jest.advanceTimersByTime(500);
    registry.notifyDeviceChanged('placa DEF5678', 'a');
    jest.advanceTimersByTime(500);
    registry.notifyVehiclesChanged('a', 'imei 123');
    expect(emit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);

    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith('tenant:a');
    expect(emit).toHaveBeenCalledTimes(1);
    const [evento, payload] = emit.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(evento).toBe('vehicles:changed');
    expect(Object.keys(payload)).toEqual(['at']);
  });

  it('notificação global (null) vai para toda sala de tenant', () => {
    const { registry, to, emit } = montar();
    registry.notifyVehiclesChanged(null, 'reconciliação');
    jest.advanceTimersByTime(2_000);
    expect(to).toHaveBeenCalledTimes(2);
    expect(to).toHaveBeenCalledWith('tenant:a');
    expect(to).toHaveBeenCalledWith('tenant:b');
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('tenants diferentes têm timers independentes', () => {
    const { registry, to } = montar();
    registry.notifyVehiclesChanged('a', 'x');
    jest.advanceTimersByTime(1_500);
    registry.notifyVehiclesChanged('b', 'y');
    jest.advanceTimersByTime(600);
    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith('tenant:a');
    jest.advanceTimersByTime(1_500);
    expect(to).toHaveBeenCalledWith('tenant:b');
  });
});
