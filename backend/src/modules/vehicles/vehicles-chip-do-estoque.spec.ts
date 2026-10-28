import { VehiclesService } from './vehicles.service';

/**
 * Dono, 28/10/2026: "ICCID e número do chip coloca pra aparecer sempre abaixo
 * do IMEI". O chip do rastreador mora no Estoque (`stock_items.iccid/line`,
 * importado da planilha); a tabela `chips` está vazia em produção. A lista do
 * Mapa leva o chip junto, casado pelo IMEI.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';

function servico(veiculos: unknown[], estoque: unknown[]) {
  const prisma = {
    vehicle: {
      findMany: jest.fn().mockResolvedValue(veiculos),
      count: jest.fn().mockResolvedValue(veiculos.length),
    },
    stockItem: { findMany: jest.fn().mockResolvedValue(estoque) },
  };
  return { s: new VehiclesService(prisma as never, {} as never, {} as never, {} as never), prisma };
}

describe('lista de veículos traz o chip do rastreador', () => {
  it('casa pelo IMEI do device e pelo uniqueId numérico', async () => {
    const { s, prisma } = servico(
      [
        { id: 'v1', uniqueId: '867689068081183', device: { imei: '867689068081183' } },
        { id: 'v2', uniqueId: '867689060000001', device: null },
        { id: 'v3', uniqueId: 'HINOVA-30175', device: null },
      ],
      [
        { imei: '867689068081183', iccid: '89553202100094685944', line: '5516998182797', operator: 'ALGAR' },
        { imei: '867689060000001', iccid: '89551805600000000001', line: null, operator: 'ARQIA' },
      ],
    );

    const r = await s.findAll(TENANT, { page: 1, perPage: 2000 });

    expect(prisma.stockItem.findMany.mock.calls[0][0].where).toEqual({
      tenantId: TENANT,
      imei: { in: ['867689068081183', '867689060000001'] },
    });
    expect(r.data.map((v) => (v as { chip: unknown }).chip)).toEqual([
      { iccid: '89553202100094685944', line: '5516998182797', operator: 'ALGAR' },
      { iccid: '89551805600000000001', line: null, operator: 'ARQIA' },
      null,
    ]);
  });

  it('sem IMEI na página não consulta o estoque', async () => {
    const { s, prisma } = servico([{ id: 'v3', uniqueId: 'HINOVA-1', device: null }], []);
    await s.findAll(TENANT, { page: 1, perPage: 2000 });
    expect(prisma.stockItem.findMany).not.toHaveBeenCalled();
  });
});
