import { BoletosService } from './boletos.service';

/** Linha do banco com campo interno plantado: nada disso pode chegar ao associado. */
const LINHA_ENVENENADA = {
  id: 'b1',
  plate: 'RJU0F75',
  mesReferente: '09/2026',
  valor: { toString: () => '250.57' },
  vencimento: '2026-09-20',
  status: 'disponivel',
  linhaDigitavel: '23793.38128',
  pdfBytes: 3_400_000,
  // veneno:
  imei: '865190071973955',
  serverHost: 'gps1.trackgo.site',
  serverPort: 5023,
  apn: 'claro.com.br',
  tagMac: 'AA:BB:CC:DD:EE:FF',
};

function service(
  linhas: unknown[],
  sincronizadoEm: Date | null = new Date('2026-09-12T08:00:00-03:00'),
  boletosForaDoPrazo = 0,
) {
  const prisma = {
    associate: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ boletosSincronizadosEm: sincronizadoEm, boletosForaDoPrazo }),
    },
    associateBoleto: { findMany: jest.fn().mockResolvedValue(linhas) },
  } as any;
  return new BoletosService(prisma);
}

describe('GET /app/boletos — contrato com o associado', () => {
  const HOJE = new Date('2026-09-12T12:00:00-03:00');

  it('nenhum campo interno vaza, por mais que exista na linha', async () => {
    const r = await service([LINHA_ENVENENADA]).listarDoAssociado('a1', 't1', HOJE);
    const texto = JSON.stringify(r);
    for (const proibido of ['865190071973955', 'gps1.trackgo.site', '5023', 'claro.com.br', 'AA:BB:CC']) {
      expect(texto).not.toContain(proibido);
    }
    expect(Object.keys(r.boletos[0]).sort()).toEqual(
      ['id', 'linhaDigitavel', 'mesReferente', 'placa', 'rotulo', 'temPdf', 'valor', 'vencimento'].sort(),
    );
  });

  it('a query filtra por tenant E por associado', async () => {
    const s = service([]);
    const prisma = (s as any).prisma;
    await s.listarDoAssociado('a1', 't1', HOJE);
    const where = prisma.associateBoleto.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('t1');
    expect(where.associateId).toBe('a1');
  });

  it('lista vazia de quem o robo JA visitou = esta em dia', async () => {
    const r = await service([]).listarDoAssociado('a1', 't1', HOJE);
    expect(r.pendente).toBe(false);
  });

  it('lista vazia de quem o robo NUNCA visitou = pendente, nao "em dia"', async () => {
    const r = await service([], null).listarDoAssociado('a1', 't1', HOJE);
    expect(r.pendente).toBe(true);
  });

  it('boleto com 6 dias de atraso nao aparece, mesmo se sobrou no banco', async () => {
    const velho = { ...LINHA_ENVENENADA, vencimento: '2026-09-06' };
    const r = await service([velho]).listarDoAssociado('a1', 't1', HOJE);
    expect(r.boletos).toHaveLength(0);
  });

  it('o rodape do Setor de Boletos vem sempre, mesmo sem boleto', async () => {
    const r = await service([]).listarDoAssociado('a1', 't1', HOJE);
    expect(r.rodape.telefones).toBe('📞 (21) 95933-5359 | (21) 98142-2100');
  });

  // Achado C3: sem isto a tela nao tem como diferenciar "esta em dia" de
  // "tem boleto antigo que o CRM ja nao emite mais".
  it('devolve o foraDoPrazo guardado do associado', async () => {
    const r = await service([], new Date('2026-09-12T08:00:00-03:00'), 2).listarDoAssociado(
      'a1', 't1', HOJE,
    );
    expect(r.foraDoPrazo).toBe(2);
  });

  it('sem foraDoPrazo guardado, devolve 0', async () => {
    const r = await service([]).listarDoAssociado('a1', 't1', HOJE);
    expect(r.foraDoPrazo).toBe(0);
  });

  // Achado do portão final: o espelho local só perde o boleto na próxima rodada do
  // robô, mas o filtro de 5 dias já vale na hora. Sem somar aqui, a lista fica vazia
  // e foraDoPrazo continua 0 — "em dia" falso por até 56h (6º dia caindo num sábado).
  it('linha que passou dos 5 dias no espelho conta em foraDoPrazo, mesmo com 0 guardado', async () => {
    const velho = { ...LINHA_ENVENENADA, vencimento: '2026-09-06' };
    const r = await service([velho], new Date('2026-09-12T08:00:00-03:00'), 0).listarDoAssociado(
      'a1', 't1', HOJE,
    );
    expect(r.boletos).toHaveLength(0);
    expect(r.foraDoPrazo).toBe(1);
  });

  it('soma o guardado do CRM com o filtrado localmente, sem contar duas vezes', async () => {
    const velho = { ...LINHA_ENVENENADA, vencimento: '2026-09-06' };
    const r = await service([velho], new Date('2026-09-12T08:00:00-03:00'), 2).listarDoAssociado(
      'a1', 't1', HOJE,
    );
    expect(r.foraDoPrazo).toBe(3);
  });
});
