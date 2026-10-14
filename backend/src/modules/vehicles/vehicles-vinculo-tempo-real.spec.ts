import { VehiclesService } from './vehicles.service';

/**
 * Cadastro e exclusão de veículo mudam o par `traccarDeviceId → tenant` que o
 * gateway usa para rotear posições. Sem avisar o registry, o carro recém-
 * cadastrado ficava até 2 min sem tempo real (e o excluído, recebendo).
 */

const TENANT = '11111111-1111-1111-1111-111111111111';

function servico(veiculo?: Record<string, unknown>) {
  const prisma = {
    vehicle: {
      findFirst: jest.fn().mockResolvedValue(veiculo ?? null),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'veh-novo', ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ ...veiculo, ...data })),
    },
  };
  const traccar = {
    getDeviceByUniqueId: jest.fn().mockResolvedValue({ id: 777 }),
    createDevice: jest.fn(),
  };
  const registry = { notifyDeviceChanged: jest.fn(), notifyVehiclesChanged: jest.fn() };
  const s = new VehiclesService(
    prisma as never,
    traccar as never,
    {} as never,
    registry as never,
  );
  return { s, prisma, registry };
}

describe('VehiclesService — vínculo avisa o tempo real', () => {
  it('cadastro com rastreador avisa o registry', async () => {
    const { s, registry } = servico();
    await s.create(
      { plate: 'ABC1D23', uniqueId: '866557086559061' } as never,
      TENANT,
    );
    expect(registry.notifyDeviceChanged).toHaveBeenCalledTimes(1);
  });

  it('exclusão de veículo com rastreador avisa o registry', async () => {
    const { s, registry } = servico({
      id: 'veh-1',
      uniqueId: '866557086559061',
      traccarDeviceId: 777,
    });
    await s.remove('veh-1', TENANT);
    expect(registry.notifyDeviceChanged).toHaveBeenCalledTimes(1);
  });

  it('exclusão de veículo sem rastreador não avisa', async () => {
    const { s, registry } = servico({
      id: 'veh-2',
      uniqueId: 'HINOVA-1',
      traccarDeviceId: null,
    });
    await s.remove('veh-2', TENANT);
    expect(registry.notifyDeviceChanged).not.toHaveBeenCalled();
    expect(registry.notifyVehiclesChanged).toHaveBeenCalledTimes(1);
  });

  it('edição de veículo avisa os painéis sem refresh do mapping', async () => {
    const { s, registry } = servico({ id: 'veh-3', uniqueId: 'X', plate: 'AAA1A11', traccarDeviceId: null });
    await s.update('veh-3', { color: 'preto' } as never, TENANT);
    expect(registry.notifyVehiclesChanged).toHaveBeenCalledTimes(1);
    expect(registry.notifyDeviceChanged).not.toHaveBeenCalled();
  });
});
