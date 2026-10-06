import { VehiclesService } from './vehicles.service';
import { DevicesService } from '../devices/devices.service';
import { ClientsService } from '../clients/clients.service';

/**
 * Paginação por `skip` precisa de ordem TOTAL. A migração da Rede gravou
 * milhares de veículos com o mesmo `created_at` (lote único): ordenando só por
 * ele, o Postgres devolvia os empatados em ordem diferente a cada página. Em
 * produção (06/10/2026) as 4 páginas do Mapa somaram 6.544 linhas e só 6.390
 * veículos distintos — 154 repetidos e, portanto, 154 que nunca chegavam. Cada
 * carga perdia um grupo diferente: "aparece no Mapa e não aparece no Ativos".
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const ESTAVEL = [{ createdAt: 'desc' }, { id: 'desc' }];

function prismaFalso() {
  const lista = jest.fn().mockResolvedValue([]);
  const contar = jest.fn().mockResolvedValue(0);
  return {
    lista,
    prisma: {
      vehicle: { findMany: lista, count: contar },
      device: { findMany: lista, count: contar },
      position: { groupBy: jest.fn().mockResolvedValue([]) },
      userVehicleAccess: {
        findMany: jest.fn().mockResolvedValue([{ vehicleId: 'v1' }]),
      },
    },
  };
}

describe('paginação com desempate por id', () => {
  it('Veículos (lista do Mapa)', async () => {
    const { prisma, lista } = prismaFalso();
    const s = new VehiclesService(prisma as never, {} as never, {} as never);
    await s.findAll(TENANT, { page: 2, perPage: 2000 });
    expect(lista.mock.calls[0][0].orderBy).toEqual(ESTAVEL);
  });

  it('Veículos do cliente (/vehicles/mine)', async () => {
    const { prisma, lista } = prismaFalso();
    const s = new VehiclesService(prisma as never, {} as never, {} as never);
    await s.findOwnedByUser('u1', TENANT, { page: 2, perPage: 2000 });
    expect(lista.mock.calls[0][0].orderBy).toEqual(ESTAVEL);
  });

  it('Dispositivos', async () => {
    const { prisma, lista } = prismaFalso();
    const s = new DevicesService(prisma as never, {} as never, {} as never);
    await s.findAll(TENANT, { page: 2, perPage: 500 });
    expect(lista.mock.calls[0][0].orderBy).toEqual(ESTAVEL);
  });

  it('Clientes Ativos sem TAG', async () => {
    const { prisma, lista } = prismaFalso();
    const s = new ClientsService(prisma as never);
    await s.findAssets(TENANT, { page: 2, perPage: 500, verTags: false });
    expect(lista.mock.calls[0][0].orderBy).toEqual(ESTAVEL);
  });
});
