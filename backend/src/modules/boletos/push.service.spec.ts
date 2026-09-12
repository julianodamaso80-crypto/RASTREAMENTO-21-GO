import { PushService, textoDoAviso } from './push.service';

describe('textoDoAviso', () => {
  it('diz o mes, o valor e o dia — na lingua do dono do carro (formato MM/YYYY)', () => {
    expect(
      textoDoAviso({ mesReferente: '09/2026', valor: 250.57, vencimento: '2026-09-20' }),
    ).toBe('Seu boleto de setembro já está disponível — R$ 250,57, vence dia 20.');
  });

  // Achado I2: o CRM manda mesReferente em YYYY-MM — com o SGA fechado não dá
  // pra provar qual formato chega em cada caminho, então os dois precisam funcionar.
  it('diz o mes certo no formato YYYY-MM', () => {
    expect(
      textoDoAviso({ mesReferente: '2026-09', valor: 250.57, vencimento: '2026-09-20' }),
    ).toBe('Seu boleto de setembro já está disponível — R$ 250,57, vence dia 20.');
  });

  it('sem valor nao inventa numero', () => {
    expect(
      textoDoAviso({ mesReferente: '09/2026', valor: null, vencimento: '2026-09-20' }),
    ).toBe('Seu boleto de setembro já está disponível.');
  });

  it('vencimento sujo do integrador nao vira "dia NaN"', () => {
    expect(
      textoDoAviso({ mesReferente: '09/2026', valor: 250.57, vencimento: '2026-09-XX' }),
    ).toBe('Seu boleto de setembro já está disponível — R$ 250,57.');
  });

  it('mesReferente vazio nao diz "de mes nenhum"', () => {
    expect(textoDoAviso({ mesReferente: '', valor: 250.57, vencimento: '2026-09-20' })).toBe(
      'Seu boleto já está disponível — R$ 250,57, vence dia 20.',
    );
  });

  it('mesReferente nulo nao diz "de mes nenhum"', () => {
    expect(textoDoAviso({ mesReferente: null, valor: 250.57, vencimento: '2026-09-20' })).toBe(
      'Seu boleto já está disponível — R$ 250,57, vence dia 20.',
    );
  });

  it('mes invalido (13) nao vira "de mes[NaN]"', () => {
    expect(
      textoDoAviso({ mesReferente: '13/2026', valor: 250.57, vencimento: '2026-09-20' }),
    ).toBe('Seu boleto já está disponível — R$ 250,57, vence dia 20.');
  });
});

// Segue o padrão de crm-boletos.client.spec.ts: fetch é global, nunca entra no
// construtor (Nest apaga `typeof fetch` pros metadados e não acha token — provado
// na Task 5), então o mock é `jest.spyOn(global, 'fetch')`.
function servico(
  tokens: any[] = [{ expoToken: 'ExponentPushToken[x]' }],
  opts: { enabled?: boolean } = {},
) {
  const prisma = {
    associatePushDevice: {
      findMany: jest.fn().mockResolvedValue(tokens),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    associateBoleto: { update: jest.fn().mockResolvedValue({}) },
  } as any;
  const config = {
    get: (k: string) =>
      ({
        'expoPush.url': 'https://exp.test/send',
        'expoPush.enabled': opts.enabled ?? true,
      } as any)[k],
  } as any;
  return { s: new PushService(prisma, config), prisma };
}

function mockFetch(impl: jest.Mock) {
  return jest.spyOn(global, 'fetch').mockImplementation(impl as any);
}

afterEach(() => {
  jest.restoreAllMocks();
});

const BOLETO = { mesReferente: '09/2026', valor: 250.57, vencimento: '2026-09-20' } as any;

describe('PushService.avisarBoletoNovo', () => {
  it('envia e carimba avisadoEm no mesmo passo', async () => {
    const { s, prisma } = servico();
    const f = mockFetch(
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ status: 'ok', id: 'ticket-1' }] }),
      }),
    );

    await s.avisarBoletoNovo('b1', 'a1', 't1', BOLETO);

    expect(f).toHaveBeenCalledTimes(1);
    expect(prisma.associateBoleto.update.mock.calls[0][0].data.avisadoEm).toBeInstanceOf(Date);
  });

  it('associado sem aparelho registrado nao dispara nada', async () => {
    const { s } = servico([]);
    const f = mockFetch(jest.fn());

    await s.avisarBoletoNovo('b1', 'a1', 't1', BOLETO);

    expect(f).not.toHaveBeenCalled();
  });

  it('falha no envio NAO carimba avisadoEm — senao o associado nunca recebe', async () => {
    const { s, prisma } = servico();
    mockFetch(jest.fn().mockRejectedValue(new Error('rede caiu')));

    await s.avisarBoletoNovo('b1', 'a1', 't1', BOLETO);

    expect(prisma.associateBoleto.update).not.toHaveBeenCalled();
  });

  it('Expo respondendo com erro HTTP tambem NAO carimba — senao nunca mais avisa', async () => {
    const { s, prisma } = servico();
    mockFetch(jest.fn().mockResolvedValue({ ok: false, status: 400 }));

    await s.avisarBoletoNovo('b1', 'a1', 't1', BOLETO);

    expect(prisma.associateBoleto.update).not.toHaveBeenCalled();
  });

  // Achado I5: a Expo responde HTTP 200 mesmo quando o ticket individual é
  // erro — quem só olha `r.ok` carimba `avisadoEm` e nunca mais avisa esse
  // boleto, mesmo o push nunca tendo chegado.
  it('Expo 200 mas nenhum ticket com sucesso: NAO carimba', async () => {
    const { s, prisma } = servico();
    mockFetch(
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ status: 'error', details: { error: 'MessageTooBig' } }],
        }),
      }),
    );

    await s.avisarBoletoNovo('b1', 'a1', 't1', BOLETO);

    expect(prisma.associateBoleto.update).not.toHaveBeenCalled();
  });

  it('Expo 200 com ticket DeviceNotRegistered: apaga aquele token e NAO carimba', async () => {
    const { s, prisma } = servico([{ expoToken: 'ExponentPushToken[morto]' }]);
    mockFetch(
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
        }),
      }),
    );

    await s.avisarBoletoNovo('b1', 'a1', 't1', BOLETO);

    expect(prisma.associatePushDevice.deleteMany).toHaveBeenCalledWith({
      where: { expoToken: 'ExponentPushToken[morto]' },
    });
    expect(prisma.associateBoleto.update).not.toHaveBeenCalled();
  });

  // Achado M9: expoPush.enabled existia na config e ninguém lia — vira
  // interruptor de emergência de verdade.
  it('expoPush.enabled=false: nao manda push nenhum e nao carimba', async () => {
    const { s, prisma } = servico([{ expoToken: 'ExponentPushToken[x]' }], { enabled: false });
    const f = mockFetch(jest.fn());

    await s.avisarBoletoNovo('b1', 'a1', 't1', BOLETO);

    expect(f).not.toHaveBeenCalled();
    expect(prisma.associateBoleto.update).not.toHaveBeenCalled();
  });
});

describe('PushService.registrarAparelho', () => {
  it('faz upsert por expoToken, um aparelho por linha', async () => {
    const { s, prisma } = servico();

    await s.registrarAparelho('a1', 't1', 'ExponentPushToken[x]', 'ios');

    expect(prisma.associatePushDevice.upsert).toHaveBeenCalledWith({
      where: { expoToken: 'ExponentPushToken[x]' },
      create: { associateId: 'a1', tenantId: 't1', expoToken: 'ExponentPushToken[x]', platform: 'ios' },
      update: { associateId: 'a1', tenantId: 't1', platform: 'ios' },
    });
  });
});
