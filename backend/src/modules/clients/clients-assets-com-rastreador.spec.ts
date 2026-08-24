import { ClientsService } from './clients.service';

/**
 * Clientes Ativos lista ATIVO, e ativo é veículo COM rastreador instalado.
 *
 * Quando o rastreador é desvinculado, o aparelho volta pro estoque e o veículo
 * sai desta tela — senão a lista vira um depósito de carros que ninguém
 * rastreia, e o total do cabeçalho para de significar frota monitorada.
 */
const TENANT = '11111111-1111-1111-1111-111111111111';

/** O filtro que prova "só quem tem rastreador vivo". */
const COM_RASTREADOR = { is: { deletedAt: null } };

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
});
