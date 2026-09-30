import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OwnershipTransferService } from './ownership-transfer.service';

/**
 * Troca de titularidade: o rastreador fica no carro, só o dono muda. A régua
 * é a mesma do "Associar (SGA)" — quem manda é a situação do cadastro.
 */
const TENANT = '11111111-1111-1111-1111-111111111111';
const VEICULO = '22222222-2222-2222-2222-222222222222';

const lookupAtivo = (extra: Record<string, unknown> = {}) => ({
  encontrado: true,
  ativo: true,
  cliente: { nome: 'Maria Nova', cpf: '222.222.222-22' },
  veiculo: {
    placa: 'ABC1D23',
    chassi: '9C2KC2500TR436058',
    codigoModelo: null,
    modelo: 'HONDA CG 160 START',
    codigoVeiculo: '9001',
    tipo: 'MOTOCICLETA (ATé 400CC)',
  },
  situacao: {
    codigo: '1',
    descricao: 'ATIVO',
    financeira: 'ADIMPLENTE',
    dataVencimento: null,
  },
  ...extra,
});

function montar(opts: {
  lookup?: Record<string, unknown>;
  associadoExistente?: { id: string; cpf: string; name: string; phone: string | null; email: string | null; hinovaCode: string | null } | null;
  outroVeiculoComAPlaca?: boolean;
  donoAtual?: { id: string; name: string; cpf: string } | null;
} = {}) {
  const vehicleUpdate = jest.fn((args) =>
    Promise.resolve({ id: VEICULO, plate: args.data.plate }),
  );
  const associateCreate = jest.fn((args) =>
    Promise.resolve({ id: 'assoc-nova', ...args.data }),
  );
  const associateUpdate = jest.fn((args) =>
    Promise.resolve({ ...opts.associadoExistente, ...args.data }),
  );
  const tx = {
    associate: {
      findFirst: jest.fn().mockResolvedValue(opts.associadoExistente ?? null),
      create: associateCreate,
      update: associateUpdate,
    },
    vehicle: { update: vehicleUpdate },
  };
  const donoAtual =
    opts.donoAtual === undefined
      ? { id: 'assoc-velha', name: 'João Antigo', cpf: '11111111111' }
      : opts.donoAtual;
  const prisma: any = {
    vehicle: {
      findFirst: jest.fn((args) => {
        // Segunda chamada: "a placa já é outro ativo?"
        if (args.where.plate) {
          return Promise.resolve(opts.outroVeiculoComAPlaca ? { id: 'outro' } : null);
        }
        return Promise.resolve({
          id: VEICULO,
          plate: 'ABC1D23',
          chassi: null,
          model: null,
          hinovaCode: null,
          associate: donoAtual,
        });
      }),
    },
    $transaction: jest.fn((fn) => fn(tx)),
  };
  const stock: any = {
    lookupSga: jest.fn().mockResolvedValue(opts.lookup ?? lookupAtivo()),
    contatoDaPendencia: jest
      .fn()
      .mockResolvedValue({ phone: '21999990000', email: null }),
  };
  // Mesma função estática do serviço real, sem instanciar o StockService.
  const { StockService } = jest.requireActual('../stock/stock.service');
  stock.constructor = StockService;
  const service = new OwnershipTransferService(prisma, stock);
  return { service, prisma, stock, tx, vehicleUpdate, associateCreate, associateUpdate };
}

describe('OwnershipTransferService', () => {
  it('passa o veículo para o associado que o SGA devolve, sem mexer no rastreador', async () => {
    const { service, vehicleUpdate, associateCreate } = montar();

    const r = await service.transfer(TENANT, VEICULO, { placa: 'abc-1d23' }, false);

    // O cliente novo nasce deduplicado por CPF só com dígitos.
    expect(associateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cpf: '22222222222', name: 'Maria Nova', phone: '21999990000' }),
      }),
    );
    const data = vehicleUpdate.mock.calls[0][0].data;
    expect(data.associateId).toBe('assoc-nova');
    expect(data.plate).toBe('ABC1D23');
    expect(data.vehicleType).toBe('MOTORCYCLE');
    expect(data.sgaStatusLabel).toBe('ATIVO');
    // Dono novo começa do zero no app e no bloqueador.
    expect(data.appAccessBlocked).toBe(false);
    expect(data.blockerAccessAllowed).toBe(false);
    // Nada aqui toca `devices`: o rastreador continua onde está.
    expect(Object.keys(data)).not.toContain('device');
    expect(r.from?.name).toBe('João Antigo');
    expect(r.to).toEqual({ id: 'assoc-nova', name: 'Maria Nova', cpf: '22222222222' });
  });

  it('reaproveita o associado que já existe com o mesmo CPF', async () => {
    const existente = { id: 'assoc-x', cpf: '22222222222', name: 'Maria', phone: '21988887777', email: null, hinovaCode: null };
    const { service, vehicleUpdate, associateCreate, associateUpdate } = montar({ associadoExistente: existente });

    await service.transfer(TENANT, VEICULO, { placa: 'ABC1D23' }, false);

    expect(associateCreate).not.toHaveBeenCalled();
    // Telefone que já existia não é sobrescrito pelo da pendência.
    expect(associateUpdate.mock.calls[0][0].data.phone).toBeUndefined();
    expect(vehicleUpdate.mock.calls[0][0].data.associateId).toBe('assoc-x');
  });

  it('INATIVO no SGA barra; com liberação só administrador passa', async () => {
    const inativo = lookupAtivo({ ativo: false, situacao: { codigo: '2', descricao: 'INATIVO', financeira: null, dataVencimento: null } });

    await expect(
      montar({ lookup: inativo }).service.transfer(TENANT, VEICULO, { placa: 'ABC1D23' }, true),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    await expect(
      montar({ lookup: inativo }).service.transfer(TENANT, VEICULO, { placa: 'ABC1D23', allowInactive: true }, false),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const { service, vehicleUpdate } = montar({ lookup: inativo });
    await service.transfer(TENANT, VEICULO, { placa: 'ABC1D23', allowInactive: true }, true);
    expect(vehicleUpdate).toHaveBeenCalled();
  });

  it('não troca para a placa de OUTRO ativo da empresa', async () => {
    const { service, vehicleUpdate } = montar({
      lookup: lookupAtivo({ veiculo: { ...lookupAtivo().veiculo, placa: 'ZZZ9Z99' } }),
      outroVeiculoComAPlaca: true,
    });

    await expect(
      service.transfer(TENANT, VEICULO, { placa: 'ZZZ9Z99' }, false),
    ).rejects.toThrow(/já é outro ativo/);
    expect(vehicleUpdate).not.toHaveBeenCalled();
  });

  it('mesmo titular no SGA: nada a trocar', async () => {
    const { service, vehicleUpdate } = montar({
      donoAtual: { id: 'a', name: 'Maria Nova', cpf: '22222222222' },
    });

    await expect(
      service.transfer(TENANT, VEICULO, { placa: 'ABC1D23' }, false),
    ).rejects.toThrow(/mesmo titular/);
    expect(vehicleUpdate).not.toHaveBeenCalled();
  });

  it('placa que o SGA não conhece não troca nada', async () => {
    const { service, vehicleUpdate } = montar({
      lookup: { ...lookupAtivo(), encontrado: false, motivo: 'Veículo não localizado' },
    });

    await expect(
      service.transfer(TENANT, VEICULO, { placa: 'ABC1D23' }, false),
    ).rejects.toThrow(/não localizado/);
    expect(vehicleUpdate).not.toHaveBeenCalled();
  });
});
