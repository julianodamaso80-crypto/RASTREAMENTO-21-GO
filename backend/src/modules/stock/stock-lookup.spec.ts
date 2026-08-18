import { StockService } from './stock.service';
import { InstallationPendingsService } from '../installation-pendings/installation-pendings.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

/**
 * Regra do vínculo: SGA ao vivo primeiro; se ele não conhece a placa (veículo
 * novo ainda sem boleto), o espelho de pendências responde — por placa OU
 * chassi. Se nenhum dos dois conhece, vale o motivo do SGA.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';

function naoEncontrado(motivo: string): HinovaLookupResult {
  return {
    encontrado: false,
    ativo: false,
    motivo,
    cliente: { nome: null, cpf: null },
    veiculo: {
      placa: null,
      chassi: null,
      codigoModelo: null,
      modelo: null,
      codigoVeiculo: null,
    },
    situacao: {
      codigo: null,
      descricao: null,
      financeira: null,
      dataVencimento: null,
    },
  };
}

function encontradoNoSga(placa: string): HinovaLookupResult {
  return {
    encontrado: true,
    ativo: true,
    cliente: { nome: 'MISAEL PEREIRA LIMA', cpf: '12444501705' },
    veiculo: {
      placa,
      chassi: '9BWAA05U7BT183000',
      codigoModelo: '4888',
      modelo: 'GOL (NOVO) 1.0 MI TOTAL FLEX 8V 4P',
      codigoVeiculo: '30175',
    },
    situacao: {
      codigo: '1',
      descricao: 'ATIVO',
      financeira: 'ADIMPLENTE',
      dataVencimento: '2026-08-10',
    },
  };
}

const PENDENCIA_MOTO_SEM_PLACA = {
  plate: '',
  chassi: '9C2KC2500TR163224',
  cpf: '09876543210',
  associateName: 'FULANO DE TAL',
  brandModel: 'HONDA CG 160 START',
  hinovaVehicleCode: '41999',
  phone: '21999990000',
  email: null,
  syncedAt: new Date('2026-08-10T13:19:36Z'),
};

describe('InstallationPendingsService.lookupNoEspelho', () => {
  function servico(pendencia: unknown) {
    const prisma = {
      installationPending: {
        findFirst: jest.fn().mockResolvedValue(pendencia),
      },
    };
    const s = new InstallationPendingsService(
      {} as never,
      prisma as never,
      {} as never,
      {} as never,
    );
    return { s, prisma };
  }

  it('devolve null quando o veículo não está no espelho', async () => {
    const { s } = servico(null);
    await expect(s.lookupNoEspelho(TENANT, 'ZZZ9Z99')).resolves.toBeNull();
  });

  it('não consulta o banco com identificador curto demais', async () => {
    const { s, prisma } = servico(null);
    await expect(s.lookupNoEspelho(TENANT, 'ABC')).resolves.toBeNull();
    expect(prisma.installationPending.findFirst).not.toHaveBeenCalled();
  });

  it('acha por chassi e mapeia pro formato do lookup do SGA', async () => {
    const { s, prisma } = servico(PENDENCIA_MOTO_SEM_PLACA);
    const r = await s.lookupNoEspelho(TENANT, '9c2kc2500tr163224');

    // Busca por placa OU chassi, normalizado em caixa alta.
    const where = prisma.installationPending.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({
      tenantId: TENANT,
      OR: [{ plate: '9C2KC2500TR163224' }, { chassi: '9C2KC2500TR163224' }],
    });

    expect(r).toMatchObject({
      encontrado: true,
      ativo: true,
      fonte: 'espelho',
      cliente: { nome: 'FULANO DE TAL', cpf: '09876543210' },
      veiculo: {
        placa: null, // moto sem placa: placa vazia vira null
        chassi: '9C2KC2500TR163224',
        modelo: 'HONDA CG 160 START',
        codigoVeiculo: '41999',
      },
      situacao: { codigo: '1', descricao: 'ATIVO', financeira: null },
    });
  });
});

describe('StockService.lookupSga', () => {
  function servico(
    vivo: HinovaLookupResult,
    espelho: HinovaLookupResult | null,
  ) {
    const hinova = { lookupByPlate: jest.fn().mockResolvedValue(vivo) };
    const pendings = {
      lookupNoEspelho: jest.fn().mockResolvedValue(espelho),
    };
    const s = new StockService(
      {} as never,
      hinova as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      pendings as never,
      {} as never,
      {} as never,
    );
    return { s, hinova, pendings };
  }

  it('SGA ao vivo responde: usa ele e marca fonte=sga, sem tocar no espelho', async () => {
    const { s, pendings } = servico(encontradoNoSga('EIN4I70'), null);
    const r = await s.lookupSga(TENANT, 'EIN4I70');
    expect(r.encontrado).toBe(true);
    expect(r.fonte).toBe('sga');
    expect(r.cliente.cpf).toBe('12444501705');
    expect(pendings.lookupNoEspelho).not.toHaveBeenCalled();
  });

  it('SGA sem boleto + espelho conhece: responde pelo espelho', async () => {
    const semBoleto = naoEncontrado(
      'Não foram encontrados boletos para o veículo',
    );
    const doEspelho: HinovaLookupResult = {
      ...encontradoNoSga('KRG4B15'),
      fonte: 'espelho',
    };
    const { s, pendings } = servico(semBoleto, doEspelho);
    const r = await s.lookupSga(TENANT, 'KRG4B15');
    expect(r.encontrado).toBe(true);
    expect(r.fonte).toBe('espelho');
    expect(pendings.lookupNoEspelho).toHaveBeenCalledWith(TENANT, 'KRG4B15');
  });

  it('nem SGA nem espelho conhecem: devolve o motivo do SGA', async () => {
    const { s } = servico(
      naoEncontrado('O veículo não foi encontrado no sistema'),
      null,
    );
    const r = await s.lookupSga(TENANT, 'RNN8E82');
    expect(r.encontrado).toBe(false);
    expect(r.motivo).toBe('O veículo não foi encontrado no sistema');
  });
});
