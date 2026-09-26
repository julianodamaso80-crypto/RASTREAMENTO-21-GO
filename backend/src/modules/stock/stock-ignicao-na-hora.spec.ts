import { StockTraccarService } from './stock-traccar.service';

/**
 * Teste de liga e desliga: quando o técnico corta a energia da ignição, a
 * plataforma tem que mostrar a chave desligada NA HORA.
 *
 * Medido em produção em 15/09/2026: com `filter.distance=10` e
 * `filter.skipLimit=600` no Traccar, veículo parado grava uma posição a cada
 * ~716 s — todas as outras viram "Position filtered by Distance filters". A
 * posição que carrega a mudança da ignição é uma delas, porque o carro não saiu
 * do lugar. Reproduzido num device de teste: das três posições enviadas na
 * mesma coordenada (ligada → desligada → ligada), só a primeira entrou.
 *
 * O Traccar resolve isso por device: `filter.skipAttributes.enable` +
 * `filter.skipAttributes` fazem a posição escapar dos filtros condicionais
 * quando ela carrega o atributo listado (FilterHandler 6.14.5, via
 * `AttributeUtil.lookup(..., deviceId)` — a chave vale por device). Com os dois
 * atributos no device de teste, as três posições gravaram em segundos.
 *
 * Por que não ligar isso no parque inteiro: o gt06/J16 manda `ignition` em toda
 * posição, então seria o mesmo que desligar o filtro de distância para 30 mil
 * rastreadores — o banco passaria a gravar ~12x mais por veículo parado.
 * Vale só para quem está em conferência ou reservado com técnico.
 */

const DEVICE = {
  id: 77,
  name: '860123456789012',
  uniqueId: '860123456789012',
  status: 'online',
  lastUpdate: '2026-09-15T16:00:00.000Z',
  positionId: 1,
  groupId: 0,
  phone: '',
  model: '',
  contact: '',
  category: '',
  disabled: false,
  attributes: {} as Record<string, unknown>,
};

function servico(device: typeof DEVICE | null = { ...DEVICE }) {
  const traccar = {
    getDeviceByUniqueId: jest.fn().mockResolvedValue(device),
    updateDevice: jest.fn().mockImplementation((_id, payload) => payload),
  };
  const prisma = { stockItem: { update: jest.fn() } };
  const s = new StockTraccarService(
    prisma as never,
    traccar as never,
    {} as never,
  );
  return { s, traccar };
}

describe('StockTraccarService.responderIgnicaoNaHora', () => {
  it('liga os dois atributos que fazem a posição escapar do filtro de distância', async () => {
    const { s, traccar } = servico();

    await s.responderIgnicaoNaHora('860123456789012');

    expect(traccar.updateDevice).toHaveBeenCalledTimes(1);
    const [id, payload] = traccar.updateDevice.mock.calls[0];
    expect(id).toBe(77);
    expect(payload.attributes['filter.skipAttributes.enable']).toBe(true);
    expect(payload.attributes['filter.skipAttributes']).toContain('ignition');
  });

  it('NÃO encurta o skipLimit: heartbeat sem ignition viraria a última posição e a chave sumiria da tela', async () => {
    // Medido em 16/09/2026 no 869890080181336 com skipLimit=30: 120 das 192
    // posições em 6 h vieram sem `ignition`, inclusive a última — a tela
    // mostrava "Não informa". Só a posição que CARREGA a chave interessa.
    const { s, traccar } = servico();

    await s.responderIgnicaoNaHora('860123456789012');

    const [, payload] = traccar.updateDevice.mock.calls[0];
    expect(payload.attributes['filter.skipLimit']).toBeUndefined();
  });

  it('device que ficou com o skipLimit=30 de 15/09: limpa ao religar', async () => {
    const { s, traccar } = servico({
      ...DEVICE,
      attributes: {
        'filter.skipAttributes.enable': true,
        'filter.skipAttributes': 'ignition',
        'filter.skipLimit': 30,
      },
    });

    await s.responderIgnicaoNaHora('860123456789012');

    const [, payload] = traccar.updateDevice.mock.calls[0];
    expect(payload.attributes['filter.skipLimit']).toBeUndefined();
    expect(payload.attributes['filter.skipAttributes.enable']).toBe(true);
  });

  it('manda o device inteiro no PUT — corpo parcial o Traccar recusa com 400', async () => {
    const { s, traccar } = servico();

    await s.responderIgnicaoNaHora('860123456789012');

    const [, payload] = traccar.updateDevice.mock.calls[0];
    expect(payload.uniqueId).toBe('860123456789012');
    expect(payload.name).toBe('860123456789012');
  });

  it('já ligado: não repete o PUT (a conferência chama a cada 10 s)', async () => {
    const { s, traccar } = servico({
      ...DEVICE,
      attributes: {
        'filter.skipAttributes.enable': true,
        'filter.skipAttributes': 'ignition',
      },
    });

    await s.responderIgnicaoNaHora('860123456789012');

    expect(traccar.updateDevice).not.toHaveBeenCalled();
  });

  it('preserva atributos que já existiam no device', async () => {
    const { s, traccar } = servico({
      ...DEVICE,
      attributes: { speedLimit: 90 },
    });

    await s.responderIgnicaoNaHora('860123456789012');

    const [, payload] = traccar.updateDevice.mock.calls[0];
    expect(payload.attributes.speedLimit).toBe(90);
    expect(payload.attributes['filter.skipAttributes.enable']).toBe(true);
  });

  it('Traccar fora do ar não derruba quem chamou', async () => {
    const traccar = {
      getDeviceByUniqueId: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      updateDevice: jest.fn(),
    };
    const s = new StockTraccarService(
      { stockItem: { update: jest.fn() } } as never,
      traccar as never,
      {} as never,
    );

    await expect(s.responderIgnicaoNaHora('860123456789012')).resolves.toBe(
      false,
    );
  });

  it('device que ainda não existe no Traccar: não tenta atualizar', async () => {
    const { s, traccar } = servico(null);

    await expect(s.responderIgnicaoNaHora('860123456789012')).resolves.toBe(
      false,
    );
    expect(traccar.updateDevice).not.toHaveBeenCalled();
  });
});

describe('StockTraccarService.voltarAoFiltroNormal', () => {
  it('equipamento instalado volta a filtrar: tira os dois atributos', async () => {
    const { s, traccar } = servico({
      ...DEVICE,
      attributes: {
        'filter.skipAttributes.enable': true,
        'filter.skipAttributes': 'ignition',
        'filter.skipLimit': 30,
        speedLimit: 90,
      },
    });

    await s.voltarAoFiltroNormal('860123456789012');

    const [, payload] = traccar.updateDevice.mock.calls[0];
    expect(payload.attributes['filter.skipAttributes.enable']).toBeUndefined();
    expect(payload.attributes['filter.skipAttributes']).toBeUndefined();
    // O skipLimit volta pro do servidor (600 s) ao sair da conferência.
    expect(payload.attributes['filter.skipLimit']).toBeUndefined();
    expect(payload.attributes.speedLimit).toBe(90);
  });

  it('device já no filtro normal: não mexe', async () => {
    const { s, traccar } = servico();

    await s.voltarAoFiltroNormal('860123456789012');

    expect(traccar.updateDevice).not.toHaveBeenCalled();
  });
});

describe('StockTraccarService.destravarEstoqueConectado', () => {
  /**
   * O time acompanha o teste de liga/desliga pelo MAPA do estoque, não pela
   * conferência (access log de 15–16/09: ~2.000 GET /stock/map e zero
   * GET /stock/:id/signal). O destravamento preso à conferência alcançou 1
   * device em 1.500. Quem precisa dele é o equipamento do estoque que está
   * falando com o servidor — é esse que está na mão do técnico.
   */
  function comEstoque(opcoes: {
    estoque: string[];
    comunicando: string[];
  }) {
    const traccar = {
      getDevices: jest.fn().mockResolvedValue(
        [...new Set([...opcoes.estoque, ...opcoes.comunicando])].map((imei, i) => ({
          ...DEVICE,
          id: i + 1,
          uniqueId: imei,
          name: imei,
          status: opcoes.comunicando.includes(imei) ? 'online' : 'offline',
          lastUpdate: null,
        })),
      ),
      getPositions: jest.fn().mockResolvedValue([]),
      getDeviceByUniqueId: jest.fn().mockImplementation((imei: string) =>
        Promise.resolve({ ...DEVICE, uniqueId: imei, name: imei, attributes: {} }),
      ),
      updateDevice: jest.fn().mockImplementation((_id, payload) => payload),
    };
    const prisma = {
      stockItem: {
        findMany: jest
          .fn()
          .mockResolvedValue(opcoes.estoque.map((imei) => ({ imei }))),
      },
    };
    const s = new StockTraccarService(prisma as never, traccar as never, {} as never);
    return { s, traccar, prisma };
  }

  it('destrava só quem é do estoque E está falando agora', async () => {
    const { s, traccar } = comEstoque({
      estoque: ['111', '222'],
      comunicando: ['111', '999'], // 999 é carro de cliente, não é estoque
    });

    await s.destravarEstoqueConectado();

    const destravados = traccar.getDeviceByUniqueId.mock.calls.map((c) => c[0]);
    expect(destravados).toEqual(['111']);
  });

  it('só olha estoque não instalado e não apagado', async () => {
    const { s, prisma } = comEstoque({ estoque: [], comunicando: [] });

    await s.destravarEstoqueConectado();

    const where = prisma.stockItem.findMany.mock.calls[0][0].where;
    expect(where.associatedAt).toBeNull();
    expect(where.deletedAt).toBeNull();
  });

  it('servidor GPS fora do ar não derruba o cron', async () => {
    const { s, traccar } = comEstoque({ estoque: ['111'], comunicando: ['111'] });
    traccar.getDevices.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(s.destravarEstoqueConectado()).resolves.toBeUndefined();
  });
});
