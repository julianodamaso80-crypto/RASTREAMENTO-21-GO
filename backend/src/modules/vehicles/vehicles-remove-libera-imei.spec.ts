import { VehiclesService } from './vehicles.service';

/**
 * Excluir veículo tem que soltar o `unique_id`, que é UNIQUE no banco inteiro e
 * guarda o IMEI do rastreador. O soft delete deixava o número preso num
 * registro invisível para toda busca (que filtra `deletedAt: null`) — e o
 * rastreador ficava impossível de instalar em qualquer outra placa, com 500
 * seco na cara do técnico. É a mesma liberação que o desvínculo já faz.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';

function servico(veiculo: { id: string; uniqueId: string }) {
  const prisma = {
    vehicle: {
      findFirst: jest.fn().mockResolvedValue(veiculo),
      update: jest.fn().mockImplementation(({ data }) => ({ ...veiculo, ...data })),
    },
  };
  const s = new VehiclesService(prisma as never, {} as never, {} as never);
  return { s, prisma };
}

describe('VehiclesService.remove', () => {
  it('solta o IMEI do veículo excluído', async () => {
    const { s, prisma } = servico({
      id: 'veh-1',
      uniqueId: '866557086559061',
    });

    await s.remove('veh-1', TENANT);

    expect(prisma.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'veh-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          uniqueId: 'RETIRADO-veh-1',
        }),
      }),
    );
  });

  it('não renomeia duas vezes um veículo que já estava sem rastreador', async () => {
    const { s, prisma } = servico({ id: 'veh-2', uniqueId: 'HINOVA-30175' });

    await s.remove('veh-2', TENANT);

    const data = prisma.vehicle.update.mock.calls[0][0].data as {
      uniqueId?: string;
    };
    expect(data.uniqueId).toBeUndefined();
  });
});
