import {
  StockApontamentoService,
  comandoServidor,
  horaDeTentar,
  numeroDoChip,
} from './stock-apontamento.service';

/**
 * Rastreador instalado que nunca falou com o servidor.
 *
 * Em 16/11/2026 havia 863 veículos ativos assim: o aparelho (lote J16 + chip
 * Algar) saía da caixa sem apontar pro nosso servidor, a instalação era aceita
 * e o associado abria o app em "OFFLINE · Aguardando primeira posição". Um SMS
 * `SERVER,0,<ip>,<porta>,0#` resolve em minutos — este arquivo protege o envio
 * automático desse SMS e os limites dele (cada SMS custa dinheiro).
 */

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const AGORA = new Date('2026-11-16T15:00:00Z');
const ha = (ms: number) => new Date(AGORA.getTime() - ms);

describe('regras do apontamento automático', () => {
  it('monta o comando em formato IP (o formato DNS é ignorado pelo J16)', () => {
    expect(comandoServidor('167.71.31.77', 5023)).toBe(
      'SERVER,0,167.71.31.77,5023,0#',
    );
  });

  it('aceita a linha com ou sem 55 e recusa o que não é celular', () => {
    expect(numeroDoChip('5516999861956')).toBe('5516999861956');
    expect(numeroDoChip('16999861956')).toBe('5516999861956');
    expect(numeroDoChip('(16) 99986-1956')).toBe('5516999861956');
    expect(numeroDoChip('')).toBeNull();
    expect(numeroDoChip(null)).toBeNull();
    expect(numeroDoChip('12345')).toBeNull();
  });

  it('espera 10 minutos depois da instalação antes do primeiro SMS', () => {
    expect(horaDeTentar(ha(5 * MIN), [], AGORA)).toBe(false);
    expect(horaDeTentar(ha(11 * MIN), [], AGORA)).toBe(true);
  });

  it('repete em 6 h, 24 h e 72 h e para na quarta tentativa', () => {
    const instalado = ha(80 * HORA);
    const t1 = ha(79 * HORA);
    expect(horaDeTentar(ha(5 * HORA), [ha(4 * HORA)], AGORA)).toBe(false);
    expect(horaDeTentar(ha(7 * HORA), [ha(6 * HORA)], AGORA)).toBe(true);
    expect(horaDeTentar(instalado, [t1, ha(70 * HORA), ha(50 * HORA)], AGORA)).toBe(true);
    expect(
      horaDeTentar(instalado, [t1, ha(70 * HORA), ha(50 * HORA), ha(2 * HORA)], AGORA),
    ).toBe(false);
  });

  it('nunca manda dois SMS ao mesmo aparelho em menos de 1 hora', () => {
    expect(horaDeTentar(ha(30 * HORA), [ha(20 * MIN)], AGORA)).toBe(false);
  });
});

function servico(opcoes: {
  linha?: string | null;
  lastUpdateNoTraccar?: string | null;
  tentativas?: Date[];
  instaladoEm?: Date;
  respostaGti?: { ok: boolean; corpo: unknown };
}) {
  const prisma = {
    device: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'dev-1',
          imei: '867689066789647',
          tenantId: 'tenant-1',
          installedAt: opcoes.instaladoEm ?? ha(20 * MIN),
        },
      ]),
    },
    stockItem: {
      findMany: jest.fn().mockResolvedValue([
        {
          imei: '867689066789647',
          tenantId: 'tenant-1',
          line: opcoes.linha === undefined ? '5516999861956' : opcoes.linha,
        },
      ]),
    },
    smsCommand: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          (opcoes.tentativas ?? []).map((createdAt) => ({ deviceId: 'dev-1', createdAt })),
        ),
      create: jest.fn().mockResolvedValue({ id: 'sms-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const traccar = {
    getDeviceByUniqueId: jest.fn().mockResolvedValue({
      id: 10558,
      lastUpdate: opcoes.lastUpdateNoTraccar ?? null,
    }),
  };
  const resposta = opcoes.respostaGti ?? {
    ok: true,
    corpo: { status: 'success', data: { id: 1, status: 'Delivered' } },
  };
  const enviar = jest.fn().mockResolvedValue({
    ok: resposta.ok,
    json: async () => resposta.corpo,
  });
  const svc = new StockApontamentoService(prisma as never, traccar as never);
  svc.enviarHttp = enviar as never;
  return { svc, prisma, traccar, enviar };
}

describe('StockApontamentoService.rodar', () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    process.env.APONTAMENTO_AUTO = '1';
    process.env.GTISMS_TOKEN = 'token-de-teste';
  });
  afterEach(() => {
    process.env = { ...ENV };
  });

  it('manda o SMS ao instalado que nunca falou e registra a tentativa', async () => {
    const { svc, prisma, enviar } = servico({});
    const r = await svc.rodar(AGORA);

    expect(r.enviados).toBe(1);
    const [, init] = enviar.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      recipient: '5516999861956',
      message: 'SERVER,0,167.71.31.77,5023,0#',
    });
    expect(prisma.smsCommand.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceId: 'dev-1',
        tenantId: 'tenant-1',
        type: 'SET_SERVER_IP',
        status: 'PENDING',
        sentBy: 'apontamento-automatico',
      }),
    });
    expect(prisma.smsCommand.update).toHaveBeenCalledWith({
      where: { id: 'sms-1' },
      data: expect.objectContaining({ status: 'SENT' }),
    });
    // Gravar antes de enviar: banco fora do ar não pode virar SMS em dobro.
    expect(prisma.smsCommand.create.mock.invocationCallOrder[0]).toBeLessThan(
      enviar.mock.invocationCallOrder[0],
    );
  });

  it('só procura instalado sem nenhuma conexão, de empresa real, dos últimos 10 dias', async () => {
    const { svc, prisma } = servico({});
    await svc.rodar(AGORA);
    const where = prisma.device.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      status: 'INSTALLED',
      deletedAt: null,
      lastConnection: null,
      tenant: { isDemo: false },
    });
    expect(where.installedAt.gte.getTime()).toBe(AGORA.getTime() - 10 * 24 * HORA);
  });

  it('não gasta SMS se o aparelho já falou com o servidor', async () => {
    const { svc, enviar } = servico({ lastUpdateNoTraccar: '2026-11-16T14:59:00Z' });
    const r = await svc.rodar(AGORA);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
  });

  it('sem número do chip não envia e conta como sem número', async () => {
    const { svc, enviar } = servico({ linha: null });
    const r = await svc.rodar(AGORA);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.semNumero).toBe(1);
  });

  it('respeita o limite de 4 tentativas', async () => {
    const { svc, enviar } = servico({
      instaladoEm: ha(100 * HORA),
      tentativas: [ha(99 * HORA), ha(90 * HORA), ha(70 * HORA), ha(20 * HORA)],
    });
    await svc.rodar(AGORA);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('registra FAILED quando a operadora de SMS recusa', async () => {
    const { svc, prisma } = servico({
      respostaGti: { ok: false, corpo: { status: 'error', message: 'Saldo insuficiente' } },
    });
    const r = await svc.rodar(AGORA);
    expect(r.falhas).toBe(1);
    expect(prisma.smsCommand.update).toHaveBeenCalledWith({
      where: { id: 'sms-1' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
  });

  it('não envia se não conseguiu registrar a tentativa', async () => {
    const { svc, prisma, enviar } = servico({});
    prisma.smsCommand.create.mockRejectedValue(new Error('banco fora'));
    const r = await svc.rodar(AGORA);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
  });

  it('fica desligado sem a chave APONTAMENTO_AUTO ou sem token', async () => {
    delete process.env.APONTAMENTO_AUTO;
    const { svc, prisma } = servico({});
    await svc.rodar(AGORA);
    expect(prisma.device.findMany).not.toHaveBeenCalled();
  });
});
