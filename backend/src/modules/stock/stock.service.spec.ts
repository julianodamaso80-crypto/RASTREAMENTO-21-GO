import * as ExcelJS from 'exceljs';
import { StockService } from './stock.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

// `pdfkit` não está instalado no ambiente local; o relatório em PDF do
// financeiro não participa de nada aqui.
jest.mock('../financial/financial-report.pdf', () => ({}));

/**
 * Com o mapa do estoque em cache (STOCK_MAP_CACHE_MS), toda escrita em
 * StockItem precisa invalidar o mapa do tenant — senão o operador valida ou
 * vincula e o mapa segue mostrando o estado anterior até o TTL vencer.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const IMEI = '866557086559061';

const ATIVO: HinovaLookupResult = {
  encontrado: true,
  ativo: true,
  fonte: 'sga',
  cliente: { nome: 'CLIENTE TESTE', cpf: '18640491704' },
  veiculo: {
    placa: 'TUK6H76',
    chassi: '9BWAA05U7BT183000',
    codigoModelo: '4888',
    modelo: 'GOL 1.0',
    codigoVeiculo: '34125',
  },
  situacao: {
    codigo: '1',
    descricao: 'ATIVO',
    financeira: 'ADIMPLENTE',
    dataVencimento: '2026-10-10',
  },
};

function servico() {
  const tx = {
    associate: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'assoc-1' }),
    },
    vehicle: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: 'veh-1', plate: 'TUK6H76' }),
      create: jest.fn().mockResolvedValue({ id: 'veh-1', plate: 'TUK6H76' }),
    },
    device: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'dev-1' }),
    },
    stockItem: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    tagKey: { findMany: jest.fn().mockResolvedValue([]) },
    stockItem: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue({
        id: 'item-1',
        imei: IMEI,
        traccarDeviceId: null,
        kind: 'RASTREADOR',
      }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'item-1' }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
    device: { findFirst: jest.fn().mockResolvedValue(null) },
    installationPending: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest
      .fn()
      .mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const stockTraccar = {
    invalidarMapa: jest.fn(),
    ensurePending: jest.fn().mockResolvedValue(0),
  };
  const s = new StockService(
    prisma as never,
    { lookupByPlate: jest.fn().mockResolvedValue(ATIVO) } as never,
    { getDeviceByUniqueId: jest.fn().mockResolvedValue(null) } as never,
    { notifyDeviceChanged: jest.fn() } as never,
    { diagnose: jest.fn().mockResolvedValue({ motivos: [] }) } as never,
    stockTraccar as never,
    {
      lookupNoEspelho: jest.fn().mockResolvedValue(null),
      removeByPlate: jest.fn().mockResolvedValue(undefined),
    } as never,
    {
      lookup: jest.fn().mockResolvedValue(null),
      contato: jest.fn().mockResolvedValue(null),
      tipoCru: jest.fn().mockResolvedValue(null),
    } as never,
    { markStopDoneByPlate: jest.fn().mockResolvedValue(undefined) } as never,
    { persistIfRelevant: jest.fn().mockResolvedValue(undefined) } as never,
    { registrarVinculo: jest.fn().mockResolvedValue(null) } as never,
    { avisarInstalado: jest.fn() } as never,
  );
  return { s, prisma, tx, stockTraccar };
}

const ordem = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];

describe('StockService — escrita em StockItem invalida o mapa do tenant', () => {
  it('validar: invalida depois de gravar a conferência', async () => {
    const { s, prisma, stockTraccar } = servico();

    await s.validate('item-1', TENANT, { approved: true }, 'u1', 'Operador');

    expect(stockTraccar.invalidarMapa).toHaveBeenCalledWith(TENANT);
    expect(ordem(stockTraccar.invalidarMapa)).toBeGreaterThan(
      ordem(prisma.stockItem.update),
    );
  });

  it('associar: invalida depois que a transação do vínculo termina', async () => {
    const { s, tx, stockTraccar } = servico();

    await s.associate('item-1', TENANT, {
      placa: 'TUK6H76',
      technicianName: 'Iury',
      installLocation: 'Embaixo do painel',
    });

    expect(stockTraccar.invalidarMapa).toHaveBeenCalledWith(TENANT);
    expect(ordem(stockTraccar.invalidarMapa)).toBeGreaterThan(
      ordem(tx.stockItem.update),
    );
  });

  it('associar com a transação falhando: nada foi gravado, nada a invalidar', async () => {
    const { s, prisma, stockTraccar } = servico();
    prisma.$transaction.mockRejectedValue(new Error('deadlock'));

    await expect(
      s.associate('item-1', TENANT, {
        placa: 'TUK6H76',
        technicianName: 'Iury',
        installLocation: 'Embaixo do painel',
      }),
    ).rejects.toThrow('deadlock');
    expect(stockTraccar.invalidarMapa).not.toHaveBeenCalled();
  });

  it('importar planilha: invalida depois dos upserts', async () => {
    const { s, prisma, stockTraccar } = servico();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('estoque');
    ws.addRow(['IMEI', 'ICCID']);
    ws.addRow([IMEI, '8955000000000000001']);
    ws.addRow(['866557086559062', '8955000000000000002']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const r = await s.importFromBuffer(buffer, TENANT);

    expect(r.imported).toBe(2);
    expect(stockTraccar.invalidarMapa).toHaveBeenCalledWith(TENANT);
    const ultimoUpsert = Math.max(
      ...prisma.stockItem.upsert.mock.invocationCallOrder,
    );
    expect(ordem(stockTraccar.invalidarMapa)).toBeGreaterThan(ultimoUpsert);
  });
});


describe('StockService.findAll — busca acha equipamento já associado', () => {
  function montar() {
    const prisma = {
      tagKey: { findMany: jest.fn().mockResolvedValue([]) },
      stockItem: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a', imei: IMEI, kind: 'RASTREADOR', deviceId: 'dev-1', associatedAt: new Date() },
          { id: 'b', imei: 'TAG1', kind: 'TAG', deviceId: null, associatedAt: new Date() },
          { id: 'c', imei: '999', kind: 'RASTREADOR', deviceId: null, associatedAt: null },
        ]),
        count: jest.fn().mockResolvedValue(3),
      },
      device: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'dev-1',
            installedAt: new Date('2026-10-01'),
            vehicle: { plate: 'ABC1D23', deletedAt: null, associate: { name: 'FULANO' } },
          },
        ]),
      },
      tagLink: {
        findMany: jest.fn().mockResolvedValue([
          { serialNumber: 'TAG1', plate: 'XYZ9K88', associateName: null, createdAt: new Date('2026-10-02') },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const s = new StockService(
      prisma as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      { avisarInstalado: jest.fn() } as never,
    );
    return { s, prisma };
  }
  const base = { page: 1, perPage: 20 } as never;

  it('com search devolve item associado com vinculo preenchido', async () => {
    const { s, prisma } = montar();
    const r = await s.findAll(TENANT, { ...(base as object), search: '8665' } as never);
    const where = prisma.stockItem.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('associatedAt');
    expect(where.deletedAt).toBeNull();
    expect(prisma.device.findMany.mock.calls[0][0].where.tenantId).toBe(TENANT);
    expect(prisma.tagLink.findMany.mock.calls[0][0].where.tenantId).toBe(TENANT);
    expect((r.data[0] as { vinculo: unknown }).vinculo).toMatchObject({
      tipo: 'INSTALADO', placa: 'ABC1D23', cliente: 'FULANO',
    });
    expect((r.data[1] as { vinculo: unknown }).vinculo).toMatchObject({
      tipo: 'VINCULADA', placa: 'XYZ9K88', cliente: null,
    });
    expect((r.data[2] as { vinculo: unknown }).vinculo).toBeNull();
  });

  it('sem search não devolve associado (filtra associatedAt: null)', async () => {
    const { s, prisma } = montar();
    await s.findAll(TENANT, base);
    const where = prisma.stockItem.findMany.mock.calls[0][0].where;
    expect(where.associatedAt).toBeNull();
  });
});
