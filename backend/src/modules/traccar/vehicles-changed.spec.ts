import { TraccarGateway } from './traccar.gateway';
import { DeviceRegistryService } from './device-registry.service';

describe('DeviceRegistryService.onChanged', () => {
  it('avisa os ouvintes a cada notifyDeviceChanged, mesmo sem refresher', () => {
    const registry = new DeviceRegistryService();
    const cb = jest.fn();
    registry.onChanged(cb);
    registry.notifyDeviceChanged('a');
    registry.notifyDeviceChanged('b');
    expect(cb).toHaveBeenNthCalledWith(1, 'a');
    expect(cb).toHaveBeenNthCalledWith(2, 'b');
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
    gateway.server = {
      to,
      sockets: {
        adapter: {
          rooms: new Map([
            ['tenant:a', new Set(['s1'])],
            ['tenant:b', new Set(['s2'])],
            ['associate:x', new Set(['s3'])],
            ['s1', new Set(['s1'])],
          ]),
        },
      },
    } as any;
    (gateway as any).registrarOuvinteVehicles();
    return { registry, to, emit };
  }

  it('3 notificações em 2 s viram 1 emit por sala de tenant', () => {
    const { registry, to, emit } = montar();
    registry.notifyDeviceChanged('um');
    jest.advanceTimersByTime(500);
    registry.notifyDeviceChanged('dois');
    jest.advanceTimersByTime(500);
    registry.notifyDeviceChanged('tres');
    expect(emit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);

    expect(to).toHaveBeenCalledTimes(2);
    expect(to).toHaveBeenCalledWith('tenant:a');
    expect(to).toHaveBeenCalledWith('tenant:b');
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      'vehicles:changed',
      expect.objectContaining({ motivo: expect.any(String), at: expect.stringMatching(/^\d{4}-/) }),
    );

    registry.notifyDeviceChanged('depois');
    jest.advanceTimersByTime(2_000);
    expect(emit).toHaveBeenCalledTimes(4);
  });
});
