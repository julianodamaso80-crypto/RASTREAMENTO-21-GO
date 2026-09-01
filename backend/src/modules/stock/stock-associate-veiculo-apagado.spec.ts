import { StockService } from './stock.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

/**
 * Veículo APAGADO continua segurando o `unique_id` — que é UNIQUE no banco
 * inteiro e guarda o IMEI do rastreador. Como a busca do vínculo só enxerga
 * veículo vivo (`deletedAt: null`), o `create` colidia com esse registro
 * invisível e o técnico levava "Erro interno do servidor" sem alternativa.
 *
 * Aconteceu de verdade: o IMEI 866557086559061 foi vinculado por engano à placa
 * RJU0F75 em 20/08/2026, o veículo foi excluído às 18:45 do mesmo dia, e as seis
 * tentativas seguintes de instalar esse aparelho (24, 25 e 26/08) morreram em
 * `Unique constraint failed on the constraint: vehicles_unique_id_key` nos
 * audit_logs de produção.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const IMEI = '866557086559061';

const ATIVO: HinovaLookupResult = {
  encontrado: true,
  ativo: true,
  fonte: 'sga',
  cliente: { nome: 'PABLO WILLIAM CORREA DE OLIVEIRA', cpf: '18640491704' },
  veiculo: {
    placa: 'TUK6H76',
    chassi: '9C2KC2210TR087437',
    codigoModelo: '10407',
    modelo: 'CG 160 TITAN',
    codigoVeiculo: '34125',
  },
  situacao: {
    codigo: '1',
    descricao: 'ATIVO',
    financeira: 'ADIMPLENTE',
    dataVencimento: '2026-08-10',
  },
};

const DTO = {
  placa: 'TUK6H76',
  technicianName: 'Iury',
  installLocation: 'Embaixo do tanque',
};

type VeiculoMock = { id: string; plate: string; deletedAt: Date | null };

/**
 * `apagados`: veículos com `deletedAt` preenchido que o banco ainda guarda.
 * A busca por veículo vivo devolve sempre null — o cenário do bug.
 */
function servico(apagados: VeiculoMock[]) {
  const achaApagado = (where: Record<string, unknown>) => {
    if (where.deletedAt === null || where.deletedAt === undefined) return null;
    if (typeof where.plate === 'string') {
      return apagados.find((v) => v.plate === where.plate) ?? null;
    }
    if (typeof where.uniqueId === 'string') {
      // Só o registro que de fato segura o IMEI pedido.
      return apagados.find((v) => v.plate !== DTO.placa) ?? null;
    }
    return null;
  };

  const tx = {
    associate: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'assoc-1' }),
    },
    vehicle: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(achaApagado(where)),
        ),
      update: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, plate: DTO.placa }),
        ),
      create: jest.fn().mockResolvedValue({ id: 'veh-novo', plate: DTO.placa }),
    },
    device: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'dev-1' }),
    },
    stockItem: { update: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    stockItem: {
      findFirst: jest.fn().mockResolvedValue({ id: 'item-1', imei: IMEI }),
    },
    vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
    device: { findFirst: jest.fn().mockResolvedValue(null) },
    installationPending: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest
      .fn()
      .mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  };

  const s = new StockService(
    prisma as never,
    { lookupByPlate: jest.fn().mockResolvedValue(ATIVO) } as never,
    { getDeviceByUniqueId: jest.fn().mockResolvedValue(null) } as never,
    { notifyDeviceChanged: jest.fn() } as never,
    {} as never,
    {} as never,
    {
      lookupNoEspelho: jest.fn().mockResolvedValue(null),
      removeByPlate: jest.fn().mockResolvedValue(undefined),
    } as never,
    {
      lookup: jest.fn().mockResolvedValue(null),
      contato: jest.fn().mockResolvedValue(null),
      // tipo do veiculo (carro x moto) — o lookup ao vivo nao devolve
      tipoCru: jest.fn().mockResolvedValue(null),
    } as never,
    { markStopDoneByPlate: jest.fn().mockResolvedValue(undefined) } as never,
    { persistIfRelevant: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { s, tx };
}

describe('StockService.associate — veículo apagado ainda segurando o IMEI', () => {
  it('solta o unique_id do veículo apagado e conclui o vínculo', async () => {
    const { s, tx } = servico([
      { id: 'veh-morto', plate: 'RJU0F75', deletedAt: new Date() },
    ]);

    await expect(s.associate('item-1', TENANT, DTO)).resolves.toMatchObject({
      ok: true,
      placa: 'TUK6H76',
    });

    expect(tx.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'veh-morto' },
        data: expect.objectContaining({ uniqueId: 'RETIRADO-veh-morto' }),
      }),
    );
    expect(tx.vehicle.create).toHaveBeenCalled();
  });

  it('placa apagada volta a viver em vez de duplicar o cadastro', async () => {
    const { s, tx } = servico([
      { id: 'veh-mesma-placa', plate: 'TUK6H76', deletedAt: new Date() },
    ]);

    await expect(s.associate('item-1', TENANT, DTO)).resolves.toMatchObject({
      ok: true,
    });

    expect(tx.vehicle.create).not.toHaveBeenCalled();
    expect(tx.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'veh-mesma-placa' },
        data: expect.objectContaining({ deletedAt: null, uniqueId: IMEI }),
      }),
    );
  });

  it('sem veículo apagado no caminho, nada de update extra', async () => {
    const { s, tx } = servico([]);

    await expect(s.associate('item-1', TENANT, DTO)).resolves.toMatchObject({
      ok: true,
    });

    expect(tx.vehicle.update).not.toHaveBeenCalled();
    expect(tx.vehicle.create).toHaveBeenCalled();
  });
});
