import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { StockService } from './stock.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

/**
 * Regra do vínculo: quem decide é a SITUAÇÃO do cliente no SGA, nunca a
 * existência de boleto. Cliente fora de ATIVO é bloqueado por padrão, e só um
 * ADMIN libera. Operador (que também chega neste endpoint) e o PWA do técnico —
 * que chama o service sem o argumento de liberação — nunca passam.
 *
 * Boleto vencido é AVISO, não barreira: o endpoint financeiro do SGA devolve um
 * boleto isolado, que pode estar vencido há mais de um ano enquanto o cadastro
 * segue ATIVO (LTP8F10 travou o técnico em campo com um boleto de 10/01/2025).
 * Inadimplência de verdade chega como situação 4 e cai na regra acima.
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

/** Ativo no cadastro, com boleto vencido: aviso na tela, instalacao liberada. */
const ATIVO_COM_BOLETO_VENCIDO: HinovaLookupResult = {
  ...INATIVO,
  ativo: true,
  boletoVencido: true,
  situacao: {
    codigo: '1',
    descricao: 'ATIVO',
    financeira: 'INADIMPLENTE',
    dataVencimento: '2026-07-10',
  },
};

function servico(lookup: HinovaLookupResult = INATIVO) {
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
  const hinova = { lookupByPlate: jest.fn().mockResolvedValue(lookup) };
  const s = new StockService(
    prisma as never,
    hinova as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { lookupNoEspelho: jest.fn().mockResolvedValue(null) } as never,
    {
      lookup: jest.fn().mockResolvedValue(null),
      contato: jest.fn().mockResolvedValue(null),
    } as never,
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

describe('StockService.associate — boleto vencido', () => {
  it('ativo com boleto vencido: avisa, mas não bloqueia o técnico', async () => {
    const { s } = servico(ATIVO_COM_BOLETO_VENCIDO);
    await expect(s.associate('item-1', TENANT, DTO_BASE)).rejects.toThrow(
      CHEGOU_NA_GRAVACAO,
    );
  });

  it('cadastro fora de ATIVO continua bloqueado, mesmo com o boleto em dia', async () => {
    const canceladoEmDia: HinovaLookupResult = {
      ...INATIVO,
      boletoVencido: false,
      situacao: { ...INATIVO.situacao, financeira: 'ADIMPLENTE' },
    };
    const { s } = servico(canceladoEmDia);
    await expect(s.associate('item-1', TENANT, DTO_BASE)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('ativo e em dia: nada bloqueia', async () => {
    const emDia: HinovaLookupResult = {
      ...ATIVO_COM_BOLETO_VENCIDO,
      boletoVencido: false,
      situacao: { ...ATIVO_COM_BOLETO_VENCIDO.situacao, financeira: 'ADIMPLENTE' },
    };
    const { s } = servico(emDia);
    await expect(s.associate('item-1', TENANT, DTO_BASE)).rejects.toThrow(
      CHEGOU_NA_GRAVACAO,
    );
  });
});
