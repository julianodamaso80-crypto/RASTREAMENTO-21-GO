import { StockService } from './stock.service';
import { InstallationPendingsService } from '../installation-pendings/installation-pendings.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

/**
 * Regra do vínculo: SGA ao vivo primeiro; se ele não conhece a placa (veículo
 * novo ainda sem boleto), responde o espelho CADASTRAL — que tem todo veículo
 * do SGA em qualquer situação — e, por último, o espelho da fila de pendências.
 * Se ninguém conhece, o operador recebe uma orientação, não o erro de boleto
 * cru da API financeira.
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
    cadastro: HinovaLookupResult | null = null,
  ) {
    const hinova = { lookupByPlate: jest.fn().mockResolvedValue(vivo) };
    const pendings = {
      lookupNoEspelho: jest.fn().mockResolvedValue(espelho),
    };
    const mirror = { lookup: jest.fn().mockResolvedValue(cadastro) };
    const s = new StockService(
      {} as never,
      hinova as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      pendings as never,
      mirror as never,
      {} as never,
      {} as never,
    );
    return { s, hinova, pendings, mirror };
  }

  it('SGA ao vivo responde: usa ele e marca fonte=sga, sem tocar no espelho', async () => {
    const { s, pendings } = servico(encontradoNoSga('EIN4I70'), null);
    const r = await s.lookupSga(TENANT, 'EIN4I70');
    expect(r.encontrado).toBe(true);
    expect(r.fonte).toBe('sga');
    expect(r.cliente.cpf).toBe('12444501705');
    expect(pendings.lookupNoEspelho).not.toHaveBeenCalled();
  });

  it('ativo no SGA com mensalidade vencida: marca boletoVencido', async () => {
    const inadimplente = encontradoNoSga('EIN4I70');
    inadimplente.situacao.financeira = 'INADIMPLENTE';
    const { s } = servico(inadimplente, null);
    const r = await s.lookupSga(TENANT, 'EIN4I70');
    expect(r.ativo).toBe(true);
    expect(r.boletoVencido).toBe(true);
  });

  it('SGA sem boleto: responde pelo espelho cadastral antes da fila de pendências', async () => {
    const doCadastro: HinovaLookupResult = {
      ...encontradoNoSga('TDL8G06'),
      fonte: 'cadastro',
    };
    const { s, pendings, mirror } = servico(
      naoEncontrado('Não foram encontrados boletos para o veículo'),
      null,
      doCadastro,
    );
    const r = await s.lookupSga(TENANT, 'TDL8G06');
    expect(r.fonte).toBe('cadastro');
    expect(mirror.lookup).toHaveBeenCalledWith(TENANT, 'TDL8G06');
    expect(pendings.lookupNoEspelho).not.toHaveBeenCalled();
  });

  it('cadastro conhece a placa mas ela está INADIMPLENTE: responde inativa, com o motivo certo', async () => {
    const inadimplente: HinovaLookupResult = {
      ...encontradoNoSga('TDL8G06'),
      ativo: false,
      fonte: 'cadastro',
      situacao: {
        codigo: '4',
        descricao: 'INADIMPLENTE',
        financeira: null,
        dataVencimento: null,
      },
    };
    const { s } = servico(
      naoEncontrado('Não foram encontrados boletos para o veículo'),
      null,
      inadimplente,
    );
    const r = await s.lookupSga(TENANT, 'TDL8G06');
    expect(r.encontrado).toBe(true);
    expect(r.ativo).toBe(false);
    expect(r.situacao.descricao).toBe('INADIMPLENTE');
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

  it('ninguém conhece a placa: orienta o operador em vez de repetir o erro de boleto', async () => {
    const { s } = servico(
      naoEncontrado('Não foram encontrados boletos para o veículo'),
      null,
    );
    const r = await s.lookupSga(TENANT, 'RNN8E82');
    expect(r.encontrado).toBe(false);
    expect(r.motivo).not.toMatch(/boleto/i);
    expect(r.motivo).toMatch(/RNN8E82/);
  });

  it('SGA fora do ar: preserva o diagnóstico, que não é problema de cadastro', async () => {
    const { s } = servico(
      naoEncontrado('Usuário com restrição de horário de acesso'),
      null,
    );
    const r = await s.lookupSga(TENANT, 'RNN8E82');
    expect(r.motivo).toBe('Usuário com restrição de horário de acesso');
  });
});
