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

  it('encurta o skipLimit: heartbeat sem o campo ignition não pode segurar a tela 10 min', async () => {
    const { s, traccar } = servico();

    await s.responderIgnicaoNaHora('860123456789012');

    const [, payload] = traccar.updateDevice.mock.calls[0];
    expect(payload.attributes['filter.skipLimit']).toBe(30);
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
        'filter.skipLimit': 30,
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
