import { StockService } from './stock.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

/**
 * Moto instalada tem que nascer moto no mapa.
 *
 * O lookup do vínculo tenta primeiro o SGA ao vivo, que é um endpoint
 * FINANCEIRO e não devolve o tipo do veículo. Sem completar esse buraco pelo
 * espelho cadastral, o veículo nascia com o default `CAR` — e foi o que
 * aconteceu em 01/09/2026 com TUG1G87 (CG 160 TITAN), TTW6E05 (CG 160 FAN) e
 * TUM4I83 (YBR 150 FACTOR), todas vinculadas horas depois de o parque inteiro
 * ter sido alinhado: ícone de carro em cima de moto e "Carro ligado" escrito
 * no painel.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const IMEI = '866557086559061';

/** Resposta do SGA ao vivo: repare que NÃO existe `tipo` aqui. */
const VIVO: HinovaLookupResult = {
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

function servico(tipoNoEspelho: string | null, chassi = VIVO.veiculo.chassi) {
  const vivo = { ...VIVO, veiculo: { ...VIVO.veiculo, chassi } };
  const tx = {
    associate: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'assoc-1' }),
    },
    vehicle: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: 'veh-1', plate: DTO.placa }),
      create: jest.fn().mockResolvedValue({ id: 'veh-1', plate: DTO.placa }),
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

  const tipoCru = jest.fn().mockResolvedValue(tipoNoEspelho);

  const s = new StockService(
    prisma as never,
    { lookupByPlate: jest.fn().mockResolvedValue(vivo) } as never,
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
      tipoCru,
    } as never,
    { markStopDoneByPlate: jest.fn().mockResolvedValue(undefined) } as never,
    { persistIfRelevant: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { s, tx, tipoCru };
}

describe('StockService.associate — carro x moto no vínculo', () => {
  it('moto no espelho do SGA nasce MOTORCYCLE mesmo com lookup ao vivo', async () => {
    const { s, tx, tipoCru } = servico('MOTOCICLETA (ATé 400CC)');

    await expect(s.associate('item-1', TENANT, DTO)).resolves.toMatchObject({
      ok: true,
    });

    expect(tipoCru).toHaveBeenCalled();
    expect(tx.vehicle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vehicleType: 'MOTORCYCLE' }),
      }),
    );
  });

  it('carro no espelho nasce CAR', async () => {
    const { s, tx } = servico('VEICULOS LEVES');

    await s.associate('item-1', TENANT, DTO);

    expect(tx.vehicle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vehicleType: 'CAR' }),
      }),
    );
  });

  it('espelho calado: o chassi decide, em vez de virar carro por omissão', async () => {
    // 9C2 é a Moto Honda da Amazônia — chassi do próprio veículo do lookup.
    const { s, tx } = servico(null);

    await s.associate('item-1', TENANT, DTO);

    expect(tx.vehicle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vehicleType: 'MOTORCYCLE' }),
      }),
    );
  });

  it('espelho calado e chassi de fábrica desconhecida: não grava tipo nenhum', async () => {
    const { s, tx } = servico(null, '93XSTGK1WNCM02140'); // Mitsubishi, fora da lista medida

    await s.associate('item-1', TENANT, DTO);

    const dados = tx.vehicle.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(dados).not.toHaveProperty('vehicleType');
  });
});
