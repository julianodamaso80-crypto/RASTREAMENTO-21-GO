import { UnprocessableEntityException } from '@nestjs/common';
import { StockService } from './stock.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

/**
 * Ciclo completo do aparelho: cliente cancelou, rastreador voltou pro estoque,
 * e agora ele vai pra OUTRA placa de OUTRO associado.
 *
 * O que este arquivo protege: o veículo do cliente antigo não pode ser
 * reaproveitado nem sobrescrito, e um aparelho que ainda está preso a um
 * veículo não pode ser instalado sem passar pelo desvínculo.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const IMEI = '866557084663055';
const CHEGOU_NA_GRAVACAO = 'CHEGOU-NA-GRAVACAO';

const LOOKUP_NOVO: HinovaLookupResult = {
  encontrado: true,
  ativo: true,
  fonte: 'sga',
  cliente: { nome: 'MARIA DE SOUZA', cpf: '12444501705' },
  veiculo: {
    placa: 'QNM6G46',
    chassi: '9BWAA05U7BT183999',
    codigoModelo: '4888',
    modelo: 'FIORINO FURGAO EVO 1.4',
    codigoVeiculo: '30999',
  },
  situacao: {
    codigo: '1',
    descricao: 'ATIVO',
    financeira: 'ADIMPLENTE',
    dataVencimento: '2026-09-10',
  },
};

const DTO = {
  placa: 'QNM6G46',
  technicianName: 'Técnico Teste',
  installLocation: 'atrás do porta-luvas',
};

/**
 * `deviceExistente`: o Device do IMEI que já existe no banco (o aparelho já
 * rodou antes). `vehiclePorBusca`: o que o dedupe do associate encontra.
 */
function servico(opcoes: {
  deviceExistente: {
    id: string;
    imei: string;
    vehicleId: string | null;
  } | null;
  vehiclePorBusca: {
    id: string;
    plate: string;
    chassi: string | null;
    hinovaCode: string | null;
  } | null;
}) {
  const tx = {
    associate: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'assoc-novo' }),
    },
    vehicle: {
      findFirst: jest.fn().mockResolvedValue(opcoes.vehiclePorBusca),
      update: jest.fn().mockResolvedValue(opcoes.vehiclePorBusca),
      create: jest.fn().mockResolvedValue({ id: 'veh-novo', plate: 'QNM6G46' }),
    },
    device: {
      findFirst: jest.fn().mockImplementation(({ where }) => {
        // Busca "quem já está neste veículo" x busca "quem já usa este IMEI".
        if (where.vehicleId) return Promise.resolve(null);
        return Promise.resolve(opcoes.deviceExistente);
      }),
      update: jest.fn().mockRejectedValue(new Error(CHEGOU_NA_GRAVACAO)),
      create: jest.fn().mockRejectedValue(new Error(CHEGOU_NA_GRAVACAO)),
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
    { lookupByPlate: jest.fn().mockResolvedValue(LOOKUP_NOVO) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { lookupNoEspelho: jest.fn().mockResolvedValue(null) } as never,
    {
      lookup: jest.fn().mockResolvedValue(null),
      contato: jest.fn().mockResolvedValue(null),
      // tipo do veiculo (carro x moto) — o lookup ao vivo nao devolve
      tipoCru: jest.fn().mockResolvedValue(null),
    } as never,
    {} as never,
    {} as never,
  );
  return { s, tx };
}

describe('StockService.associate — aparelho que voltou do estoque', () => {
  it('cria o veículo novo em vez de reaproveitar o do cliente antigo', async () => {
    // Depois do desvínculo, o veículo antigo guarda RETIRADO-<id>, então o
    // dedupe por uniqueId não casa com o IMEI e a busca não devolve nada.
    const { s, tx } = servico({
      deviceExistente: { id: 'dev-1', imei: IMEI, vehicleId: null },
      vehiclePorBusca: null,
    });

    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      CHEGOU_NA_GRAVACAO,
    );

    expect(tx.vehicle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ plate: 'QNM6G46', uniqueId: IMEI }),
      }),
    );
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });

  it('recusa o IMEI que ainda está preso a outro veículo, nomeando o ocupante', async () => {
    const { s, tx } = servico({
      deviceExistente: { id: 'dev-1', imei: IMEI, vehicleId: 'veh-antigo' },
      vehiclePorBusca: null,
    });

    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      UnprocessableEntityException,
    );
    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      /desvincul/i,
    );
    expect(tx.device.update).not.toHaveBeenCalled();
    expect(tx.device.create).not.toHaveBeenCalled();
  });

  it('quando o veículo já existe (mesma placa), grava o IMEI atual no unique_id', async () => {
    const { s, tx } = servico({
      deviceExistente: { id: 'dev-1', imei: IMEI, vehicleId: null },
      vehiclePorBusca: {
        id: 'veh-existente',
        plate: 'QNM6G46',
        chassi: null,
        hinovaCode: null,
      },
    });

    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      CHEGOU_NA_GRAVACAO,
    );

    expect(tx.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'veh-existente' },
        data: expect.objectContaining({ uniqueId: IMEI }),
      }),
    );
  });

  it('limpa os carimbos de retirada do device reinstalado', async () => {
    const { s, tx } = servico({
      deviceExistente: { id: 'dev-1', imei: IMEI, vehicleId: null },
      vehiclePorBusca: null,
    });
    tx.device.update.mockResolvedValue({ id: 'dev-1' });
    tx.stockItem.update.mockRejectedValue(new Error(CHEGOU_NA_GRAVACAO));

    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      CHEGOU_NA_GRAVACAO,
    );

    expect(tx.device.update.mock.calls[0][0].data).toMatchObject({
      uninstalledAt: null,
      uninstalledBy: null,
      uninstallReason: null,
    });
  });
});
