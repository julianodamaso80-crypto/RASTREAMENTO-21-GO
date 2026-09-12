import { BoletosSyncService } from './boletos-sync.service';

const SABADO = new Date('2026-09-12T12:00:00-03:00');
const SEGUNDA = new Date('2026-09-14T09:00:00-03:00');

function monta(
  opts: {
    associados?: any[];
    doCrm?: any[];
    foraDoPrazo?: number | null;
    crmFalhou?: boolean;
    boletosGuardados?: Record<string, string[]>;
    pdfJaGuardado?: boolean;
  } = {},
) {
  const guardados = opts.boletosGuardados ?? {};
  const prisma = {
    associate: {
      findMany: jest.fn().mockResolvedValue(opts.associados ?? []),
      update: jest.fn().mockResolvedValue({}),
    },
    associateBoleto: {
      upsert: jest.fn().mockResolvedValue({}),
      // Responde ao `where` de verdade: se ignorasse notIn/associateId, um
      // `notIn` trocado por `in` (apagar os vivos) passaria despercebido.
      findMany: jest.fn().mockImplementation(async (args: any) => {
        const doAssociado = guardados[args.where.associateId] ?? [];
        const notIn: string[] = args.where.nossoNumero?.notIn ?? [];
        return doAssociado
          .filter((n: string) => !notIn.includes(n))
          .map((nossoNumero: string) => ({ nossoNumero }));
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
    },
    associateBoletoPdf: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(opts.pdfJaGuardado ? { nossoNumero: '99' } : null),
      aggregate: jest.fn().mockResolvedValue({ _sum: { } }),
    },
  } as any;
  const crm = {
    // `null` simula CRM fora do ar (achado C1) — distinto de uma lista vazia legítima.
    buscarPorCpf: jest
      .fn()
      .mockResolvedValue(
        opts.crmFalhou
          ? null
          : { boletos: opts.doCrm ?? [], foraDoPrazo: 'foraDoPrazo' in opts ? opts.foraDoPrazo : 0 },
      ),
    baixarPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 x')),
  } as any;
  const push = { avisarBoletoNovo: jest.fn().mockResolvedValue(undefined) } as any;
  return { s: new BoletosSyncService(prisma, crm, push), prisma, crm, push };
}

describe('BoletosSyncService.rodada', () => {
  it('no sabado nao fala com ninguem — a credencial da Hinova esta recusada', async () => {
    const { s, crm } = monta({ associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }] });
    const r = await s.rodada(SABADO);
    expect(crm.buscarPorCpf).not.toHaveBeenCalled();
    expect(r.associados).toBe(0);
  });

  it('na segunda pergunta ao CRM por cada associado que ja usou o app', async () => {
    const { s, crm } = monta({
      associados: [
        { id: 'a1', tenantId: 't1', cpf: '11144477735' },
        { id: 'a2', tenantId: 't1', cpf: '52998224725' },
      ],
    });
    await s.rodada(SEGUNDA);
    expect(crm.buscarPorCpf).toHaveBeenCalledTimes(2);
  });

  it('so busca quem ja entrou no app (lastLoginAt nao nulo)', async () => {
    const { s, prisma } = monta();
    await s.rodada(SEGUNDA);
    expect(prisma.associate.findMany.mock.calls[0][0].where.lastLoginAt).toEqual({ not: null });
  });

  it('grava o boleto e baixa o PDF quando ha link', async () => {
    const { s, prisma, crm } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      doCrm: [{
        nossoNumero: '99', placa: 'RJU0F75', mesReferente: '09/2026', valor: 250.57,
        vencimento: '2026-09-20', status: 'disponivel',
        linhaDigitavel: '23793', linkPdf: 'https://hinova.test/b.pdf',
      }],
    });
    const r = await s.rodada(SEGUNDA);
    expect(prisma.associateBoleto.upsert).toHaveBeenCalledTimes(1);
    expect(crm.baixarPdf).toHaveBeenCalledWith('https://hinova.test/b.pdf');
    expect(prisma.associateBoletoPdf.upsert).toHaveBeenCalledTimes(1);
    expect(r.pdfs).toBe(1);
  });

  it('sem link (SGA fechado) grava valor e vencimento e nao tenta PDF', async () => {
    const { s, prisma, crm } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      doCrm: [{
        nossoNumero: '99', placa: 'RJU0F75', mesReferente: '09/2026', valor: 250.57,
        vencimento: '2026-09-20', status: 'disponivel', linhaDigitavel: null, linkPdf: null,
      }],
    });
    await s.rodada(SEGUNDA);
    expect(prisma.associateBoleto.upsert).toHaveBeenCalledTimes(1);
    expect(crm.baixarPdf).not.toHaveBeenCalled();
  });

  it('avisa uma vez so: boleto ja avisado nao gera push de novo', async () => {
    const { s, push, prisma } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      doCrm: [{
        nossoNumero: '99', placa: 'RJU0F75', mesReferente: '09/2026', valor: 250.57,
        vencimento: '2026-09-20', status: 'disponivel', linhaDigitavel: '1', linkPdf: null,
      }],
    });
    prisma.associateBoleto.upsert.mockResolvedValue({ id: 'b1', avisadoEm: new Date() });
    await s.rodada(SEGUNDA);
    expect(push.avisarBoletoNovo).not.toHaveBeenCalled();
  });

  it('apaga boleto que saiu da lista do CRM (pagou ou passou dos 5 dias)', async () => {
    const { s, prisma } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      doCrm: [],
    });
    await s.rodada(SEGUNDA);
    expect(prisma.associateBoleto.deleteMany).toHaveBeenCalled();
    expect(prisma.associateBoletoPdf.deleteMany).toHaveBeenCalled();
  });

  it('carimba a visita mesmo quando o associado nao tem boleto nenhum', async () => {
    const { s, prisma } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      doCrm: [],
    });
    await s.rodada(SEGUNDA);
    expect(prisma.associate.update.mock.calls[0][0].data.boletosSincronizadosEm)
      .toBeInstanceOf(Date);
  });

  it('carimba a visita mesmo quando o associado nao tem CPF', async () => {
    const { s, prisma, crm } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: null }],
    });
    await s.rodada(SEGUNDA);
    expect(crm.buscarPorCpf).not.toHaveBeenCalled();
    expect(prisma.associate.update.mock.calls[0][0].data.boletosSincronizadosEm)
      .toBeInstanceOf(Date);
  });

  it('so apaga o boleto que sumiu do CRM, nunca o que continua vivo', async () => {
    const { s, prisma } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      boletosGuardados: { a1: ['99', '88'] },
      doCrm: [{
        nossoNumero: '99', placa: 'RJU0F75', mesReferente: '09/2026', valor: 250.57,
        vencimento: '2026-09-20', status: 'disponivel', linhaDigitavel: null, linkPdf: null,
      }],
    });
    await s.rodada(SEGUNDA);
    expect(prisma.associateBoleto.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', associateId: 'a1', nossoNumero: { in: ['88'] } },
    });
    expect(prisma.associateBoletoPdf.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', nossoNumero: { in: ['88'] } },
    });
  });

  it('com { comPdf: false } grava o boleto mas nao baixa o PDF', async () => {
    const { s, prisma, crm } = monta({
      doCrm: [{
        nossoNumero: '99', placa: 'RJU0F75', mesReferente: '09/2026', valor: 250.57,
        vencimento: '2026-09-20', status: 'disponivel',
        linhaDigitavel: '23793', linkPdf: 'https://hinova.test/b.pdf',
      }],
    });
    const r = await s.sincronizarAssociado(
      { id: 'a1', tenantId: 't1', cpf: '11144477735' },
      { comPdf: false },
    );
    expect(prisma.associateBoleto.upsert).toHaveBeenCalledTimes(1);
    expect(crm.baixarPdf).not.toHaveBeenCalled();
    expect(prisma.associateBoletoPdf.upsert).not.toHaveBeenCalled();
    expect(r.pdfs).toBe(0);
  });

  it('sem opcoes (padrao do robo) continua baixando o PDF', async () => {
    const { s, crm } = monta({
      doCrm: [{
        nossoNumero: '99', placa: 'RJU0F75', mesReferente: '09/2026', valor: 250.57,
        vencimento: '2026-09-20', status: 'disponivel',
        linhaDigitavel: '23793', linkPdf: 'https://hinova.test/b.pdf',
      }],
    });
    const r = await s.sincronizarAssociado({ id: 'a1', tenantId: 't1', cpf: '11144477735' });
    expect(crm.baixarPdf).toHaveBeenCalledWith('https://hinova.test/b.pdf');
    expect(r.pdfs).toBe(1);
  });

  it('um erro no upsert de um associado nao aborta os demais da rodada', async () => {
    const { s, prisma, crm } = monta({
      associados: [
        { id: 'a1', tenantId: 't1', cpf: '11144477735' },
        { id: 'a2', tenantId: 't1', cpf: '52998224725' },
        { id: 'a3', tenantId: 't1', cpf: '85337897097' },
      ],
      doCrm: [{
        nossoNumero: '1', placa: 'ABC1234', mesReferente: '09/2026', valor: 100,
        vencimento: '2026-09-20', status: 'disponivel', linhaDigitavel: null, linkPdf: null,
      }],
    });
    prisma.associateBoleto.upsert.mockImplementation(async (args: any) => {
      if (args.create.associateId === 'a2') throw new Error('conexao caiu');
      return {};
    });
    const r = await s.rodada(SEGUNDA);
    expect(crm.buscarPorCpf).toHaveBeenCalledTimes(3);
    expect(r.gravados).toBe(2);
    expect(r.falhas).toBe(1);
  });

  // Achado C1: CRM fora do ar não pode ser lido como "ninguém deve nada".
  describe('CRM fora do ar (buscarPorCpf devolve null)', () => {
    it('nao apaga boleto nenhum do associado', async () => {
      const { s, prisma } = monta({
        associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
        boletosGuardados: { a1: ['99'] },
        crmFalhou: true,
      });
      await s.rodada(SEGUNDA);
      expect(prisma.associateBoleto.deleteMany).not.toHaveBeenCalled();
      expect(prisma.associateBoletoPdf.deleteMany).not.toHaveBeenCalled();
    });

    it('nao carimba a visita — associado continua "pendente", nao "em dia"', async () => {
      const { s, prisma } = monta({
        associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
        crmFalhou: true,
      });
      await s.rodada(SEGUNDA);
      expect(prisma.associate.update).not.toHaveBeenCalled();
    });

    it('conta como falha e segue pros próximos associados da rodada', async () => {
      const { s, prisma, crm } = monta({
        associados: [
          { id: 'a1', tenantId: 't1', cpf: '11144477735' },
          { id: 'a2', tenantId: 't1', cpf: '52998224725' },
        ],
        crmFalhou: true,
      });
      const r = await s.rodada(SEGUNDA);
      expect(crm.buscarPorCpf).toHaveBeenCalledTimes(2);
      expect(r.falhas).toBe(2);
      expect(prisma.associate.update).not.toHaveBeenCalled();
    });
  });

  // Achado C3: sem isto "sem boleto" nunca diferenciava quem está em dia de
  // quem tem pendência velha (>5 dias) que o CRM já não emite mais.
  it('grava o foraDoPrazo do CRM no associado, mesmo sem boleto nenhum', async () => {
    const { s, prisma } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      doCrm: [],
      foraDoPrazo: 3,
    });
    await s.rodada(SEGUNDA);
    expect(prisma.associate.update.mock.calls[0][0].data.boletosForaDoPrazo).toBe(3);
  });

  // Achado do portão final: CRM respondendo 200 sem o campo foraDoPrazo (null)
  // nao pode zerar em silencio uma contagem financeira que ja estava guardada.
  it('CRM sem o campo foraDoPrazo nao mexe no contador guardado', async () => {
    const { s, prisma } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      doCrm: [],
      foraDoPrazo: null,
    });
    await s.rodada(SEGUNDA);
    expect(prisma.associate.update.mock.calls[0][0].data).not.toHaveProperty('boletosForaDoPrazo');
  });

  // Achado I3: ~400 boletos x 3,4 MB x 3 rodadas/dia estourava disco do droplet.
  describe('PDF já guardado (achado I3)', () => {
    it('nao baixa de novo quando ja tem o arquivo guardado', async () => {
      const { s, prisma, crm } = monta({
        pdfJaGuardado: true,
        doCrm: [{
          nossoNumero: '99', placa: 'RJU0F75', mesReferente: '09/2026', valor: 250.57,
          vencimento: '2026-09-20', status: 'disponivel',
          linhaDigitavel: '23793', linkPdf: 'https://hinova.test/b.pdf',
        }],
      });
      const r = await s.sincronizarAssociado({ id: 'a1', tenantId: 't1', cpf: '11144477735' });
      expect(crm.baixarPdf).not.toHaveBeenCalled();
      expect(prisma.associateBoletoPdf.upsert).not.toHaveBeenCalled();
      expect(r.pdfs).toBe(0);
    });

    it('baixa quando ainda nao tem o arquivo guardado', async () => {
      const { s, crm } = monta({
        pdfJaGuardado: false,
        doCrm: [{
          nossoNumero: '99', placa: 'RJU0F75', mesReferente: '09/2026', valor: 250.57,
          vencimento: '2026-09-20', status: 'disponivel',
          linhaDigitavel: '23793', linkPdf: 'https://hinova.test/b.pdf',
        }],
      });
      const r = await s.sincronizarAssociado({ id: 'a1', tenantId: 't1', cpf: '11144477735' });
      expect(crm.baixarPdf).toHaveBeenCalledWith('https://hinova.test/b.pdf');
      expect(r.pdfs).toBe(1);
    });
  });
});
