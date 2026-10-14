import {
  invalidarCacheDeTags,
  ultimasPosicoes,
  vinculosDaTela,
} from './clients-tags';

function fakePrisma() {
  const n = { link: 0, sga: 0, raw: 0 };
  const prisma = {
    tagLink: {
      findMany: jest.fn(async () => {
        n.link++;
        return [
          {
            id: '1',
            serialNumber: 'S1',
            plate: 'ABC1234',
            chassi: null,
            hinovaVehicleCode: null,
            associateName: 'Fulano',
            associateCpf: null,
            installLocation: null,
            origin: 'ESTOQUE',
            verdict: 'OK',
            checkedAt: null,
          },
        ];
      }),
    },
    sgaVehicle: {
      findMany: jest.fn(async () => {
        n.sga++;
        return [];
      }),
    },
    $queryRaw: jest.fn(async () => {
      n.raw++;
      return [];
    }),
  };
  return { prisma: prisma as any, n };
}

describe('cache de TAGs por tenant', () => {
  const original = process.env.TAGS_CACHE_MS;
  let agora = 1_000_000;
  beforeEach(() => {
    process.env.TAGS_CACHE_MS = '30000'; // no jest o cache vem desligado por padrão
    agora += 10 * 60_000; // fora do TTL de qualquer teste anterior
    jest.spyOn(Date, 'now').mockImplementation(() => agora);
    invalidarCacheDeTags('t1');
    invalidarCacheDeTags('t2');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (original === undefined) delete process.env.TAGS_CACHE_MS;
    else process.env.TAGS_CACHE_MS = original;
  });

  it('duas chamadas dentro do TTL batem no banco uma vez; expira após 30 s', async () => {
    const { prisma, n } = fakePrisma();
    await vinculosDaTela(prisma, 't1');
    await vinculosDaTela(prisma, 't1');
    expect(n.link).toBe(1);
    await ultimasPosicoes(prisma, 't1', ['S1']);
    await ultimasPosicoes(prisma, 't1', ['S1']);
    const rawAntes = n.raw;
    agora += 30_001;
    await vinculosDaTela(prisma, 't1');
    expect(n.link).toBe(2);
    await ultimasPosicoes(prisma, 't1', ['S1']);
    expect(n.raw).toBeGreaterThan(rawAntes);
  });

  it('tenants são isolados', async () => {
    const { prisma, n } = fakePrisma();
    await vinculosDaTela(prisma, 't1');
    await vinculosDaTela(prisma, 't2');
    expect(n.link).toBe(2);
    await ultimasPosicoes(prisma, 't1', ['S1']);
    const raw = n.raw;
    await ultimasPosicoes(prisma, 't2', ['S1']);
    expect(n.raw).toBe(raw + 1);
  });

  it('invalidarCacheDeTags força a próxima chamada ao banco, só daquele tenant', async () => {
    const { prisma, n } = fakePrisma();
    await vinculosDaTela(prisma, 't1');
    await vinculosDaTela(prisma, 't2');
    await ultimasPosicoes(prisma, 't1', ['S1']);
    invalidarCacheDeTags('t1');
    await vinculosDaTela(prisma, 't1');
    await vinculosDaTela(prisma, 't2');
    expect(n.link).toBe(3);
    const raw = n.raw;
    await ultimasPosicoes(prisma, 't1', ['S1']);
    expect(n.raw).toBe(raw + 1);
  });

  it('conjuntos de seriais diferentes têm entradas diferentes; ordem e duplicata não contam', async () => {
    const { prisma, n } = fakePrisma();
    await ultimasPosicoes(prisma, 't1', ['A', 'B']);
    await ultimasPosicoes(prisma, 't1', ['B', 'A', 'A']);
    expect(n.raw).toBe(1);
    await ultimasPosicoes(prisma, 't1', ['A', 'C']);
    expect(n.raw).toBe(2);
  });

  it('TAGS_CACHE_MS=0 desliga o cache', async () => {
    process.env.TAGS_CACHE_MS = '0';
    const { prisma, n } = fakePrisma();
    await vinculosDaTela(prisma, 't1');
    await vinculosDaTela(prisma, 't1');
    expect(n.link).toBe(2);
    await ultimasPosicoes(prisma, 't1', ['S1']);
    await ultimasPosicoes(prisma, 't1', ['S1']);
    expect(n.raw).toBeGreaterThanOrEqual(4);
  });
});
