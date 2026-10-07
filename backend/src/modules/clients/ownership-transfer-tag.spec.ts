import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OwnershipTransferService } from './ownership-transfer.service';

/**
 * Troca de titularidade de TAG sem rastreador: não há Vehicle nem Associate, o
 * dono mora no `tag_links`. Mesma régua do SGA da troca de veículo.
 */
const TENANT = '11111111-1111-1111-1111-111111111111';
const LINK = '33333333-3333-3333-3333-333333333333';

const lookup = (extra: Record<string, unknown> = {}) => ({
  encontrado: true,
  ativo: true,
  cliente: { nome: 'Maria Nova', cpf: '222.222.222-22' },
  veiculo: { placa: 'ABC1D23', chassi: '9C2KC2500TR436058', codigoVeiculo: '9001' },
  situacao: { codigo: '1', descricao: 'ATIVO', financeira: 'ADIMPLENTE', dataVencimento: null },
  ...extra,
});

function montar(opts: { lookup?: Record<string, unknown>; link?: unknown; outroVeiculo?: boolean } = {}) {
  const link =
    opts.link === undefined
      ? {
          id: LINK,
          plate: 'ABC1D23',
          chassi: null,
          hinovaVehicleCode: null,
          associateName: 'João Antigo',
          associateCpf: '11111111111',
        }
      : opts.link;
  const prisma: any = {
    tagLink: {
      findFirst: jest.fn().mockResolvedValue(link),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    vehicle: { findFirst: jest.fn().mockResolvedValue(opts.outroVeiculo ? { id: 'v' } : null) },
  };
  const stock: any = { lookupSga: jest.fn().mockResolvedValue(opts.lookup ?? lookup()) };
  const { StockService } = jest.requireActual('../stock/stock.service');
  stock.constructor = StockService;
  return { service: new OwnershipTransferService(prisma, stock), prisma };
}

describe('OwnershipTransferService.transferTag', () => {
  it('passa o vínculo para o dono que o SGA devolve, filtrando por tenant', async () => {
    const { service, prisma } = montar();

    const r = await service.transferTag(TENANT, LINK, { placa: 'abc-1d23' }, false);

    expect(prisma.tagLink.findFirst.mock.calls[0][0].where).toMatchObject({ id: LINK, tenantId: TENANT, deletedAt: null });
    const upd = prisma.tagLink.updateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: LINK, tenantId: TENANT, deletedAt: null });
    expect(upd.data).toMatchObject({
      plate: 'ABC1D23',
      associateName: 'Maria Nova',
      associateCpf: '22222222222',
      hinovaVehicleCode: '9001',
    });
    expect(r.from?.name).toBe('João Antigo');
    expect(r.to).toMatchObject({ name: 'Maria Nova', cpf: '22222222222' });
  });

  it('vínculo de outro tenant ou apagado: 404', async () => {
    const { service, prisma } = montar({ link: null });
    await expect(service.transferTag(TENANT, LINK, { placa: 'ABC1D23' }, false)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tagLink.updateMany).not.toHaveBeenCalled();
  });

  it('INATIVO no SGA barra; com liberação só administrador passa', async () => {
    const inativo = lookup({ ativo: false, situacao: { codigo: '2', descricao: 'INATIVO', financeira: null, dataVencimento: null } });
    await expect(
      montar({ lookup: inativo }).service.transferTag(TENANT, LINK, { placa: 'ABC1D23' }, true),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      montar({ lookup: inativo }).service.transferTag(TENANT, LINK, { placa: 'ABC1D23', allowInactive: true }, false),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const { service, prisma } = montar({ lookup: inativo });
    await service.transferTag(TENANT, LINK, { placa: 'ABC1D23', allowInactive: true }, true);
    expect(prisma.tagLink.updateMany).toHaveBeenCalled();
  });

  it('mesmo titular no SGA: nada a trocar', async () => {
    const { service, prisma } = montar({
      link: { id: LINK, plate: 'ABC1D23', chassi: null, hinovaVehicleCode: null, associateName: 'Maria Nova', associateCpf: '222.222.222-22' },
    });
    await expect(service.transferTag(TENANT, LINK, { placa: 'ABC1D23' }, false)).rejects.toThrow(/mesmo titular/);
    expect(prisma.tagLink.updateMany).not.toHaveBeenCalled();
  });

  it('não move a TAG para a placa de um ativo com rastreador', async () => {
    const { service, prisma } = montar({
      lookup: lookup({ veiculo: { placa: 'ZZZ9Z99', chassi: null, codigoVeiculo: '1' } }),
      outroVeiculo: true,
    });
    await expect(service.transferTag(TENANT, LINK, { placa: 'ZZZ9Z99' }, false)).rejects.toThrow(/já é outro ativo/);
    expect(prisma.tagLink.updateMany).not.toHaveBeenCalled();
  });
});
