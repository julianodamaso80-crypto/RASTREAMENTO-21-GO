import { StockService } from './stock.service';
import type { DeviceHealth } from '../traccar/device-health.service';

/**
 * Conferência em pacote: o operador testa vários equipamentos ao mesmo tempo,
 * com os técnicos girando a chave em campo. É o que a RedeVeiculos chama de
 * "Validação por pacote" (select múltiplo + lista de IMEIs colada, e um card ao
 * vivo por equipamento).
 *
 * Aqui o que importa é que a tela peça UMA vez e receba todos: com polling de
 * 10 s, 20 equipamentos abertos dariam 120 requisições por minuto.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';

function saude(imei: string, ligada: boolean): DeviceHealth {
  return {
    imei,
    encontradoNoGps: true,
    jaReportou: true,
    comunicando: true,
    lastUpdate: '2026-09-15T16:00:00.000Z',
    gps: {
      ok: true,
      fixTime: '2026-09-15T16:00:00.000Z',
      idadeSegundos: 10,
      satellites: 12,
      latitude: -22.9,
      longitude: -43.1,
      address: 'Rua Teste, 1',
    },
    energia: { volts: null, sistema: null, faixa: 'sem-leitura', bateriaInterna: 80 },
    ignicao: { reportada: true, ligada },
    velocidade: 0,
    direcao: 0,
    distanceM: null,
    checkOk: true,
    motivos: [],
    indisponivel: false,
  };
}

function servico(itens: Array<{ id: string; imei: string }>) {
  const prisma = {
    stockItem: {
      findMany: jest.fn().mockResolvedValue(
        itens.map((i) => ({ ...i, traccarDeviceId: null })),
      ),
    },
  };
  const stockTraccar = {
    ensureDevice: jest.fn().mockResolvedValue(1),
    responderIgnicaoNaHora: jest.fn().mockResolvedValue(true),
  };
  const deviceHealth = {
    diagnose: jest
      .fn()
      .mockImplementation((imei: string) =>
        Promise.resolve(saude(imei, imei.endsWith('1'))),
      ),
  };
  const s = new StockService(
    prisma as never, // prisma
    {} as never, // hinova
    {} as never, // traccar
    {} as never, // deviceRegistry
    deviceHealth as never,
    stockTraccar as never,
    {} as never, // installationPendings
    {} as never, // mirror
    {} as never, // routes
    {} as never, // positions,
    { registrarVinculo: jest.fn().mockResolvedValue(null) } as never,
  );
  return { s, prisma, stockTraccar, deviceHealth };
}

describe('StockService.signalBatch — conferência em pacote', () => {
  const ITENS = [
    { id: 'a1111111-1111-1111-1111-111111111111', imei: '860000000000001' },
    { id: 'b2222222-2222-2222-2222-222222222222', imei: '860000000000002' },
  ];

  it('devolve a saúde de cada equipamento pedido, com o id do estoque', async () => {
    const { s } = servico(ITENS);

    const res = await s.signalBatch(
      ITENS.map((i) => i.id),
      TENANT,
    );

    expect(res).toHaveLength(2);
    expect(res[0].id).toBe(ITENS[0].id);
    expect(res[0].imei).toBe(ITENS[0].imei);
    expect(res[0].health.ignicao.ligada).toBe(true);
    expect(res[1].health.ignicao.ligada).toBe(false);
  });

  it('liga a resposta imediata de ignição em todos antes do teste', async () => {
    const { s, stockTraccar } = servico(ITENS);

    await s.signalBatch(
      ITENS.map((i) => i.id),
      TENANT,
    );

    expect(stockTraccar.responderIgnicaoNaHora).toHaveBeenCalledTimes(2);
    expect(stockTraccar.responderIgnicaoNaHora).toHaveBeenCalledWith(
      '860000000000001',
    );
  });

  it('só olha itens do próprio tenant', async () => {
    const { s, prisma } = servico(ITENS);

    await s.signalBatch([ITENS[0].id], TENANT);

    const where = prisma.stockItem.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.deletedAt).toBeNull();
  });

  it('lista vazia não vai ao banco nem ao Traccar', async () => {
    const { s, prisma, deviceHealth } = servico([]);

    await expect(s.signalBatch([], TENANT)).resolves.toEqual([]);
    expect(prisma.stockItem.findMany).not.toHaveBeenCalled();
    expect(deviceHealth.diagnose).not.toHaveBeenCalled();
  });

  it('um equipamento que o Traccar não respondeu não derruba o pacote', async () => {
    const { s, deviceHealth } = servico(ITENS);
    deviceHealth.diagnose
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(saude(ITENS[1].imei, false));

    const res = await s.signalBatch(
      ITENS.map((i) => i.id),
      TENANT,
    );

    expect(res).toHaveLength(2);
    expect(res[0].health.indisponivel).toBe(true);
    expect(res[1].health.ignicao.ligada).toBe(false);
  });
});
