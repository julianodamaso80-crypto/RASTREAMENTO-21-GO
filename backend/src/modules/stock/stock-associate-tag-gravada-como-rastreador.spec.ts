import { StockService } from './stock.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

/**
 * Dono, 03/11/2026: "Associar cliente e ativo" da TAG 868294085452035 na
 * KZM6F99 dava "A placa KZM6F99 já está com o rastreador IMEI 867689069036871
 * instalado". A TAG tinha entrado no Estoque como RASTREADOR (adoção
 * automática de 08/10) e seguia o caminho do rastreador. TAG vai junto do
 * rastreador do carro: o vínculo tem que corrigir o tipo e seguir como TAG.
 */

const TENANT = 'b55baec8-c4da-41b7-be9b-9da951710430';
const TAG = '868294085452035';

const ATIVO: HinovaLookupResult = {
  encontrado: true,
  ativo: true,
  fonte: 'sga',
  cliente: { nome: 'FABIO RANGEL BONADIMAN', cpf: '01021302724' },
  veiculo: {
    placa: 'KZM6F99',
    chassi: '9BWAL5BZ1KP500320',
    codigoModelo: '1',
    modelo: 'POLO 1.6',
    codigoVeiculo: '9',
  },
  situacao: { codigo: '1', descricao: 'ATIVO', financeira: 'ADIMPLENTE', dataVencimento: '2026-11-10' },
};

function servico() {
  const tx = {
    tagLink: { create: jest.fn().mockResolvedValue({}) },
    stockItem: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    tagKey: { findMany: jest.fn().mockResolvedValue([]) },
    stockItem: {
      count: jest.fn().mockImplementation(({ where }: { where: { imei: { startsWith: string } } }) =>
        Promise.resolve(where.imei.startsWith === '868294' ? 999 : 0),
      ),
      findFirst: jest.fn().mockResolvedValue({ id: 'item-1', imei: TAG, kind: 'RASTREADOR' }),
      update: jest.fn().mockResolvedValue({}),
    },
    tagLink: { findFirst: jest.fn().mockResolvedValue(null) },
    device: { findFirst: jest.fn().mockRejectedValue(new Error('caminho do rastreador')) },
    vehicle: { findFirst: jest.fn().mockRejectedValue(new Error('caminho do rastreador')) },
    $transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const s = new StockService(
    prisma as never,
    { lookupByPlate: jest.fn().mockResolvedValue(ATIVO) } as never,
    {} as never,
    {} as never,
    {} as never,
    { invalidarMapa: jest.fn() } as never,
    { lookupNoEspelho: jest.fn().mockResolvedValue(null) } as never,
    {
      lookup: jest.fn().mockResolvedValue(null),
      contato: jest.fn().mockResolvedValue(null),
      tipoCru: jest.fn().mockResolvedValue(null),
    } as never,
    {} as never,
    {} as never,
    { registrarVinculo: jest.fn().mockResolvedValue(null) } as never,
    { avisarInstalado: jest.fn() } as never,
  );
  return { s, prisma, tx };
}

describe('StockService.associate — TAG gravada como rastreador', () => {
  it('corrige o tipo para TAG e vincula como TAG, sem tocar no rastreador do carro', async () => {
    const { s, prisma, tx } = servico();

    const r = await s.associate('item-1', TENANT, {
      placa: 'KZM6F99',
      technicianName: 'caua',
      installLocation: 'carpete',
    });

    expect(r).toMatchObject({ tag: true, placa: 'KZM6F99' });
    expect(prisma.stockItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { kind: 'TAG', status: 'TAG' },
    });
    expect(tx.tagLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serialNumber: TAG, plate: 'KZM6F99', installLocation: 'carpete' }),
      }),
    );
    expect(prisma.device.findFirst).not.toHaveBeenCalled();
  });
});
