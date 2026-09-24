import { NotFoundException } from '@nestjs/common';
import { StockService } from './stock.service';

/**
 * "Desvincular TAG" (dono, 24/09/2026): associado cancelou, a TAG volta ao
 * Estoque. O vínculo vive em `tag_links` — nunca em Device — então soltar a
 * TAG não pode tocar o rastreador do mesmo carro nem o Traccar.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const SERIAL = '808092604071374';

function montar({
  vinculos = [{ id: 'link-1', plate: 'RIW1H29' }],
  item = { id: 'item-tag' } as { id: string } | null,
} = {}) {
  const tx = {
    tagLink: { updateMany: jest.fn().mockResolvedValue({ count: vinculos.length }) },
    stockItem: { update: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}) },
    device: { update: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = {
    tagLink: { findMany: jest.fn().mockResolvedValue(vinculos) },
    stockItem: { findFirst: jest.fn().mockResolvedValue(item) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const traccar = { updateDevice: jest.fn(), deleteDevice: jest.fn() };
  const s = new StockService(
    prisma as never,
    {} as never,
    traccar as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { s, prisma, tx, traccar };
}

describe('Estoque — Desvincular TAG', () => {
  it('encerra o vínculo e devolve o item ao estoque disponível', async () => {
    const { s, prisma, tx, traccar } = montar();
    const r = await s.desvincularTag(SERIAL, TENANT);

    expect(prisma.tagLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, serialNumber: SERIAL, deletedAt: null } }),
    );
    expect(tx.tagLink.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, serialNumber: SERIAL, deletedAt: null },
      data: expect.objectContaining({ deletedAt: expect.any(Date), verdict: 'INATIVO' }),
    });
    expect(tx.stockItem.update).toHaveBeenCalledWith({
      where: { id: 'item-tag' },
      data: expect.objectContaining({
        associatedAt: null,
        assignedTechnicianId: null,
        assignedAt: null,
        deletedAt: null,
        kind: 'TAG',
      }),
    });
    expect(r).toEqual({ serialNumber: SERIAL, placa: 'RIW1H29' });
    // O rastreador do mesmo carro fica onde está.
    expect(tx.device.update).not.toHaveBeenCalled();
    expect(tx.device.updateMany).not.toHaveBeenCalled();
    expect(traccar.updateDevice).not.toHaveBeenCalled();
  });

  it('TAG vinculada pela Rede sem item de estoque ganha um item novo', async () => {
    const { s, tx } = montar({ item: null });
    await s.desvincularTag(SERIAL, TENANT);

    expect(tx.stockItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: TENANT, imei: SERIAL, kind: 'TAG', status: 'TAG' }),
    });
  });

  it('procura o item mesmo apagado, senão o create estoura o único (tenant, imei)', async () => {
    const { s, prisma } = montar();
    await s.desvincularTag(SERIAL, TENANT);

    expect(prisma.stockItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, imei: SERIAL } }),
    );
  });

  it('sem vínculo vivo responde 404 e não grava nada', async () => {
    const { s, prisma } = montar({ vinculos: [] });
    await expect(s.desvincularTag(SERIAL, TENANT)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
