import { StockService } from './stock.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

/**
 * O diálogo "Associar" consulta o SGA ao digitar a placa e o POST de associar
 * consultava de novo (~10 s no total). Resultado ENCONTRADO fica 2 min em cache;
 * falha e "não encontrado" nunca.
 */

const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';

const ENCONTRADO = (placa: string): HinovaLookupResult => ({
  encontrado: true,
  ativo: true,
  fonte: 'sga',
  cliente: { nome: 'MISAEL', cpf: '12444501705' },
  veiculo: {
    placa,
    chassi: '9BWAA05U7BT183000',
    codigoModelo: '4888',
    modelo: 'GOL',
    codigoVeiculo: '30175',
    tipo: 'CARRO',
  },
  situacao: {
    codigo: '1',
    descricao: 'ATIVO',
    financeira: 'ADIMPLENTE',
    dataVencimento: '2026-08-10',
  },
});

const NAO_ENCONTRADO = {
  ...ENCONTRADO('X'),
  encontrado: false,
  ativo: false,
  motivo: 'nada',
} as HinovaLookupResult;

function servico(lookupByPlate: jest.Mock) {
  const prisma = {
    stockItem: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'item-1', imei: '860123456789012' }),
    },
    vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
    device: { findFirst: jest.fn().mockResolvedValue(null) },
    installationPending: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockResolvedValue({
      associate: { id: 'a1' },
      vehicle: { id: 'v1' },
      device: { id: 'd1' },
    }),
  };
  const s = new StockService(
    prisma as never,
    { lookupByPlate } as never,
    {
      getDeviceByUniqueId: jest.fn().mockResolvedValue(null),
      createDevice: jest.fn().mockRejectedValue(new Error('traccar fora')),
    } as never,
    { notifyDeviceChanged: jest.fn() } as never,
    {} as never,
    { invalidarMapa: jest.fn() } as never,
    {
      lookupNoEspelho: jest.fn().mockResolvedValue(null),
      removeByPlate: jest.fn().mockResolvedValue(undefined),
    } as never,
    {
      lookup: jest.fn().mockResolvedValue(null),
      tipoCru: jest.fn().mockResolvedValue(null),
    } as never,
    { markStopDoneByPlate: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    { registrarVinculo: jest.fn().mockResolvedValue(null) } as never,
  );
  return { s };
}

describe('StockService.lookupSga — cache de 2 min', () => {
  it('duas consultas da mesma placa: o SGA é chamado uma vez', async () => {
    const hinova = jest.fn().mockResolvedValue(ENCONTRADO('EIN4I70'));
    const { s } = servico(hinova);
    const a = await s.lookupSga(T1, 'EIN4I70');
    const b = await s.lookupSga(T1, 'EIN4I70');
    expect(b).toEqual(a);
    expect(hinova).toHaveBeenCalledTimes(1);
  });

  it('o termo é normalizado por trim, maiúscula e sem espaços', async () => {
    const hinova = jest.fn().mockResolvedValue(ENCONTRADO('EIN4I70'));
    const { s } = servico(hinova);
    await s.lookupSga(T1, 'EIN4I70');
    await s.lookupSga(T1, '  ein4i70 ');
    await s.lookupSga(T1, 'ein 4i70');
    expect(hinova).toHaveBeenCalledTimes(1);
  });

  it('hífen não é removido: "abc-1234" e "ABC1234" não compartilham a chave', async () => {
    const hinova = jest.fn().mockResolvedValue(ENCONTRADO('ABC1234'));
    const { s } = servico(hinova);
    await s.lookupSga(T1, 'abc-1234');
    await s.lookupSga(T1, 'ABC1234');
    expect(hinova).toHaveBeenCalledTimes(2);
  });

  it('empresas e placas diferentes ficam isoladas', async () => {
    const hinova = jest.fn().mockResolvedValue(ENCONTRADO('EIN4I70'));
    const { s } = servico(hinova);
    await s.lookupSga(T1, 'EIN4I70');
    await s.lookupSga(T2, 'EIN4I70');
    await s.lookupSga(T1, 'OUT1A23');
    expect(hinova).toHaveBeenCalledTimes(3);
  });

  it('erro do SGA não é guardado: a segunda consulta vai ao SGA', async () => {
    const hinova = jest
      .fn()
      .mockRejectedValueOnce(new Error('SGA fora'))
      .mockResolvedValueOnce(ENCONTRADO('EIN4I70'));
    const { s } = servico(hinova);
    await expect(s.lookupSga(T1, 'EIN4I70')).rejects.toThrow('SGA fora');
    await expect(s.lookupSga(T1, 'EIN4I70')).resolves.toMatchObject({
      encontrado: true,
    });
    expect(hinova).toHaveBeenCalledTimes(2);
  });

  it('"não encontrado" não é guardado', async () => {
    const hinova = jest.fn().mockResolvedValue(NAO_ENCONTRADO);
    const { s } = servico(hinova);
    await s.lookupSga(T1, 'EIN4I70');
    await s.lookupSga(T1, 'EIN4I70');
    expect(hinova).toHaveBeenCalledTimes(2);
  });

  it('o associate reaproveita a consulta do diálogo e, ao concluir, a próxima é ao vivo', async () => {
    const hinova = jest.fn().mockResolvedValue(ENCONTRADO('EIN4I70'));
    const { s } = servico(hinova);
    await s.lookupSga(T1, 'EIN4I70');
    const r = await s.associate('item-1', T1, {
      placa: 'EIN4I70',
      technicianName: 'Técnico',
      installLocation: 'porta-luvas',
    });
    expect(r.ok).toBe(true);
    expect(hinova).toHaveBeenCalledTimes(1);
    await s.lookupSga(T1, 'EIN4I70');
    expect(hinova).toHaveBeenCalledTimes(2);
  });
});
