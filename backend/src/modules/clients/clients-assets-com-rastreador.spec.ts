import { ClientsService } from './clients.service';
import { BLE_DEVICE_MODELS } from '../../common/constants/ble-models';

/**
 * Clientes Ativos lista ATIVO, e ativo é veículo COM rastreador instalado.
 *
 * Quando o rastreador é desvinculado, o aparelho volta pro estoque e o veículo
 * sai desta tela — senão a lista vira um depósito de carros que ninguém
 * rastreia, e o total do cabeçalho para de significar frota monitorada.
 *
 * TAG Bluetooth também não conta: um veículo tem um equipamento só, então
 * quem está com TAG não está com rastreador e vive na tela de TAGs ativas.
 */
const TENANT = '11111111-1111-1111-1111-111111111111';

/** O filtro que prova "só quem tem rastreador GPS vivo". */
const COM_RASTREADOR = {
  is: { deletedAt: null, model: { notIn: [...BLE_DEVICE_MODELS] } },
};

function montar() {
  const findManyArgs: any[] = [];
  const countArgs: any[] = [];
  const groupByArgs: any[] = [];
  const prisma: any = {
    vehicle: {
      findMany: jest.fn((args) => {
        findManyArgs.push(args);
        return Promise.resolve([]);
      }),
      count: jest.fn((args) => {
        countArgs.push(args);
        return Promise.resolve(0);
      }),
      groupBy: jest.fn((args) => {
        groupByArgs.push(args);
        return Promise.resolve([]);
      }),
    },
    position: { groupBy: jest.fn().mockResolvedValue([]) },
    device: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new ClientsService(prisma);
  return { service, findManyArgs, countArgs, groupByArgs };
}

describe('ClientsService — a tela só lista ativo com rastreador', () => {
  it('a listagem exige rastreador instalado', async () => {
    const { service, findManyArgs, countArgs } = montar();

    await service.findAssets(TENANT, {});

    expect(findManyArgs[0].where.device).toEqual(COM_RASTREADOR);
    // O total tem que usar a mesma régua da lista, senão o cabeçalho conta
    // carros que não aparecem embaixo.
    expect(countArgs[0].where.device).toEqual(COM_RASTREADOR);
  });

  it('a busca por texto não afrouxa a régua do rastreador', async () => {
    const { service, findManyArgs } = montar();

    await service.findAssets(TENANT, { search: 'ADW0Z41' });

    expect(findManyArgs[0].where.device).toEqual(COM_RASTREADOR);
    expect(findManyArgs[0].where.OR).toBeDefined();
  });

  it('os números do resumo contam a mesma coisa que a lista', async () => {
    const { service, groupByArgs } = montar();

    await service.assetsSummary(TENANT);

    expect(groupByArgs[0].where.device).toEqual(COM_RASTREADOR);
  });

  it('veículo com TAG Bluetooth não entra: TAG não é rastreador', async () => {
    const { service, findManyArgs, countArgs, groupByArgs } = montar();

    await service.findAssets(TENANT, {});
    await service.assetsSummary(TENANT);

    for (const args of [findManyArgs[0], countArgs[0], groupByArgs[0]]) {
      expect(args.where.device.is.model.notIn).toEqual(
        expect.arrayContaining(['BLE_KTAG', 'BLE_REDTAG', 'BLE_AIRTAG_GENERIC']),
      );
    }
  });
});
