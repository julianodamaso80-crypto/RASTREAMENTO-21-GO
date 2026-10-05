import { TraccarGateway } from './traccar.gateway';

/**
 * O painel recebe posição em lote de 1 s (`positions:batch`), não uma por
 * frame: ~42 posições/s para 15 sockets eram ~620 frames/s e 15% da CPU do
 * backend (05/10/2026). O app do associado continua com `position:update`,
 * porque é a sala dele e o app publicado escuta esse evento.
 */

function posicaoBoa(deviceId: number) {
  return {
    deviceId,
    latitude: -22.9,
    longitude: -43.55,
    valid: true,
    outdated: false,
    accuracy: 8,
    attributes: {},
    fixTime: new Date().toISOString(),
  };
}

function montar() {
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  const gateway = new TraccarGateway(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  gateway.server = { to } as any;
  const interno = gateway as unknown as {
    deviceTenantMap: Map<number, string>;
    deviceAssociateMap: Map<number, string>;
    handleTraccarMessage: (m: { positions?: unknown[] }) => void;
  };
  interno.deviceTenantMap.set(1, 'tenant-a');
  interno.deviceTenantMap.set(2, 'tenant-a');
  interno.deviceTenantMap.set(3, 'tenant-b');
  interno.deviceAssociateMap.set(2, 'assoc-x');
  return { gateway, interno, to, emit };
}

describe('TraccarGateway — posições em lote para o painel', () => {
  it('segura as posições do tenant e emite um positions:batch por tenant no flush', () => {
    const { gateway, interno, to, emit } = montar();

    interno.handleTraccarMessage({ positions: [posicaoBoa(1), posicaoBoa(2), posicaoBoa(3)] });

    // Nada para a sala do tenant antes do flush…
    expect(to).not.toHaveBeenCalledWith('tenant:tenant-a');
    // …mas o associado dono recebe na hora, como antes.
    expect(to).toHaveBeenCalledWith('associate:assoc-x');
    expect(emit).toHaveBeenCalledWith('position:update', expect.objectContaining({ deviceId: 2 }));

    gateway.flushPositionsBatch();

    expect(to).toHaveBeenCalledWith('tenant:tenant-a');
    expect(to).toHaveBeenCalledWith('tenant:tenant-b');
    const lotes = emit.mock.calls.filter((c) => c[0] === 'positions:batch');
    expect(lotes).toHaveLength(2);
    const loteA = lotes.find((c) => (c[1] as Array<{ deviceId: number }>).length === 2)![1];
    expect((loteA as Array<{ deviceId: number }>).map((p) => p.deviceId)).toEqual([1, 2]);
    // Nunca `position:update` para a sala do tenant.
    expect(emit).not.toHaveBeenCalledWith('position:update', expect.objectContaining({ deviceId: 1 }));
  });

  it('flush sem nada acumulado não emite e o lote não repete', () => {
    const { gateway, interno, emit } = montar();
    interno.handleTraccarMessage({ positions: [posicaoBoa(1)] });
    gateway.flushPositionsBatch();
    gateway.flushPositionsBatch();
    expect(emit.mock.calls.filter((c) => c[0] === 'positions:batch')).toHaveLength(1);
  });

  it('device:update do tenant também vai em lote; o do associado continua na hora', () => {
    const { gateway, interno, to, emit } = montar();
    (interno as unknown as { handleTraccarMessage: (m: { devices?: unknown[] }) => void }).handleTraccarMessage({
      devices: [{ id: 1, status: 'online' }, { id: 2, status: 'online' }],
    });

    expect(to).not.toHaveBeenCalledWith('tenant:tenant-a');
    expect(emit).toHaveBeenCalledWith('device:update', expect.objectContaining({ id: 2 }));

    gateway.flushPositionsBatch();

    expect(to).toHaveBeenCalledWith('tenant:tenant-a');
    const lotes = emit.mock.calls.filter((c) => c[0] === 'devices:batch');
    expect(lotes).toHaveLength(1);
    expect((lotes[0][1] as Array<{ id: number }>).map((d) => d.id)).toEqual([1, 2]);
    expect(emit).not.toHaveBeenCalledWith('device:update', expect.objectContaining({ id: 1 }));
  });

  it('posição reprovada pela qualidade não entra no lote', () => {
    const { gateway, interno, emit } = montar();
    interno.handleTraccarMessage({ positions: [{ ...posicaoBoa(1), valid: false }] });
    gateway.flushPositionsBatch();
    expect(emit).not.toHaveBeenCalled();
  });
});
