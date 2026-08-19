import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { StockService } from './stock.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

/**
 * Regra do vínculo com associado INATIVO no SGA: bloqueado por padrão, e só um
 * ADMIN pode liberar. Operador (que também chega neste endpoint) e o PWA do
 * técnico — que chama o service sem o argumento de liberação — nunca passam.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const CHEGOU_NA_GRAVACAO = 'CHEGOU-NA-GRAVACAO';

const INATIVO: HinovaLookupResult = {
  encontrado: true,
  ativo: false,
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
    codigo: '4',
    descricao: 'CANCELADO',
    financeira: 'INADIMPLENTE',
    dataVencimento: '2026-05-10',
  },
};

const DTO_BASE = {
  placa: 'EIN4I70',
  technicianName: 'Técnico Teste',
  installLocation: 'atrás do porta-luvas',
};

function servico() {
  const prisma = {
    stockItem: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'item-1', imei: '860123456789012' }),
    },
    vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
    device: { findFirst: jest.fn().mockResolvedValue(null) },
    installationPending: { findFirst: jest.fn().mockResolvedValue(null) },
    // Sentinela: se a execução chegou aqui, todas as validações passaram.
    $transaction: jest.fn().mockRejectedValue(new Error(CHEGOU_NA_GRAVACAO)),
  };
  const hinova = { lookupByPlate: jest.fn().mockResolvedValue(INATIVO) };
  const s = new StockService(
    prisma as never,
    hinova as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { lookupNoEspelho: jest.fn().mockResolvedValue(null) } as never,
    {} as never,
    {} as never,
  );
  return { s, prisma };
}

describe('StockService.associate — associado inativo no SGA', () => {
  it('sem pedido de liberação: recusa com 422 e diz que só admin libera', async () => {
    const { s } = servico();
    await expect(s.associate('item-1', TENANT, DTO_BASE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    await expect(s.associate('item-1', TENANT, DTO_BASE)).rejects.toThrow(
      /administrador/i,
    );
  });

  it('pedido de liberação sem ser admin (operador ou PWA do técnico): 403', async () => {
    const { s } = servico();
    await expect(
      s.associate('item-1', TENANT, { ...DTO_BASE, allowInactive: true }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('admin liberando: passa da barreira e segue para a gravação', async () => {
    const { s } = servico();
    await expect(
      s.associate('item-1', TENANT, { ...DTO_BASE, allowInactive: true }, true),
    ).rejects.toThrow(CHEGOU_NA_GRAVACAO);
  });

  it('admin sem marcar a liberação: continua bloqueado em 422', async () => {
    const { s } = servico();
    await expect(s.associate('item-1', TENANT, DTO_BASE, true)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });
});
