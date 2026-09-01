import { UnprocessableEntityException } from '@nestjs/common';
import { StockService } from './stock.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

/**
 * Placa que já tem rastreador instalado não pode receber um segundo.
 *
 * `devices.vehicle_id` é UNIQUE. Sem esta checagem, o `device.create` estourava
 * a constraint e o técnico levava um 500 sem explicação — foram 17 tentativas
 * de instalação perdidas assim em 20/08/2026, todas com a mesma mensagem
 * ("Unique constraint failed on the fields: (`vehicle_id`)") nos audit_logs.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const CHEGOU_NA_GRAVACAO = 'CHEGOU-NA-GRAVACAO';

const ATIVO: HinovaLookupResult = {
  encontrado: true,
  ativo: true,
  fonte: 'sga',
  cliente: { nome: 'MISAEL PEREIRA LIMA', cpf: '12444501705' },
  veiculo: {
    placa: 'EIN4I70',
    chassi: '9BWAA05U7BT183000',
    codigoModelo: '4888',
    modelo: 'GOL (NOVO) 1.0 MI TOTAL FLEX 8V 4P',
    codigoVeiculo: '30175',
  },
  situacao: {
    codigo: '1',
    descricao: 'ATIVO',
    financeira: 'ADIMPLENTE',
    dataVencimento: '2026-09-10',
  },
};

const DTO = {
  placa: 'EIN4I70',
  technicianName: 'Técnico Teste',
  installLocation: 'atrás do porta-luvas',
};

const IMEI_NOVO = '860123456789012';
const VEICULO = { id: 'veh-1', plate: 'EIN4I70', chassi: null, hinovaCode: null };

/**
 * `deviceJaNoVeiculo`: o rastreador que a placa já tem. `null` = placa livre.
 */
function servico(deviceJaNoVeiculo: { id: string; imei: string } | null) {
  const tx = {
    associate: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'assoc-1' }),
    },
    vehicle: {
      findFirst: jest.fn().mockResolvedValue(VEICULO),
      update: jest.fn().mockResolvedValue(VEICULO),
    },
    device: {
      // Busca por vehicleId (a checagem nova) e por imei (a de sempre).
      findFirst: jest.fn().mockImplementation(({ where }) => {
        if (where.vehicleId) return Promise.resolve(deviceJaNoVeiculo);
        return Promise.resolve(null);
      }),
      create: jest.fn().mockRejectedValue(new Error(CHEGOU_NA_GRAVACAO)),
    },
  };

  const prisma = {
    stockItem: {
      findFirst: jest.fn().mockResolvedValue({ id: 'item-1', imei: IMEI_NOVO }),
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

describe('StockService.associate — placa que já tem rastreador', () => {
  it('recusa com 422 nomeando o IMEI instalado, em vez de estourar a constraint', async () => {
    const { s, tx } = servico({ id: 'dev-antigo', imei: '866557086559061' });

    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      UnprocessableEntityException,
    );
    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      /866557086559061/,
    );
    expect(tx.device.create).not.toHaveBeenCalled();
  });

  it('placa livre: o vínculo segue normalmente', async () => {
    const { s } = servico(null);
    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      CHEGOU_NA_GRAVACAO,
    );
  });

  it('mesmo rastreador reinstalado na mesma placa: não bloqueia', async () => {
    const { s, tx } = servico({ id: 'dev-1', imei: IMEI_NOVO });
    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      CHEGOU_NA_GRAVACAO,
    );
    expect(tx.device.create).toHaveBeenCalled();
  });
});
