import { BleTagsService } from './ble-tags.service';

/**
 * "TAG ativa" é TAG em uso: vinculada a um veículo e ainda instalada.
 *
 * A régua espelha a de Clientes Ativos. TAG parada no armário (sem veículo) ou
 * já retirada não pode entrar — senão a lista deixa de significar TAG em campo
 * e o atendimento passa a ligar pra cliente que devolveu o equipamento.
 */
const TENANT = '11111111-1111-1111-1111-111111111111';

function montar() {
  const findManyArgs: any[] = [];
  const prisma: any = {
    device: {
      findMany: jest.fn((args) => {
        findManyArgs.push(args);
        return Promise.resolve([]);
      }),
    },
  };
  return { service: new BleTagsService(prisma), findManyArgs };
}

describe('BleTagsService.findActive', () => {
  it('só traz TAG vinculada a veículo e ainda instalada', async () => {
    const { service, findManyArgs } = montar();

    await service.findActive(TENANT);

    const where = findManyArgs[0].where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.vehicleId).toEqual({ not: null });
    expect(where.uninstalledAt).toBeNull();
    expect(where.deletedAt).toBeNull();
  });

  it('só considera modelo de TAG Bluetooth, nunca rastreador GPS', async () => {
    const { service, findManyArgs } = montar();

    await service.findActive(TENANT);

    expect(findManyArgs[0].where.model.in).toEqual(
      expect.arrayContaining(['BLE_KTAG', 'BLE_REDTAG', 'BLE_AIRTAG_GENERIC']),
    );
  });

  it('nunca devolve a chave privada da TAG na listagem', async () => {
    const { service, findManyArgs } = montar();

    await service.findActive(TENANT);

    expect(findManyArgs[0].omit).toEqual({
      bleAdvKeyPrivate: true,
      bleAdvKeyHashed: true,
    });
  });

  it('traz o cliente junto — a tela é de atendimento', async () => {
    const { service, findManyArgs } = montar();

    await service.findActive(TENANT);

    expect(findManyArgs[0].include.vehicle.select.associate).toBeDefined();
  });
});
