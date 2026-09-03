import { InstallationPendingsService } from './installation-pendings.service';

/**
 * O clique em "Sincronizar" tem que voltar em minutos, não em uma hora.
 *
 * Orçamento medido contra a API real do SGA em 03/09/2026:
 *   varredura de veículos (26.449) ............ 141s
 *   varredura de associados (22.926) .......... 105s
 *   as duas EM PARALELO ....................... 134s   (sem nenhum 406)
 *   geocoding de 1.277 CEPs sem cache ......... ~1.900s  ← o item dominante
 *
 * Duas coisas seguram o clique além do necessário:
 *
 * 1. As duas varreduras são independentes — o SGA entrega uma lista de veículos
 *    e uma de associados, e o cruzamento só acontece depois que ambas chegam.
 *    Rodar em série custa 246s onde 134s bastam.
 *
 * 2. O geocoding fica no caminho crítico. Ele é best-effort por natureza (o CEP
 *    que não resolve fica sem coordenada e a pendência entra na fila do mesmo
 *    jeito) e serve à rota inteligente, não à tela de pendências — mas a fila
 *    só era gravada depois que a última chamada de rede voltasse. Com a tela
 *    desistindo em 20 min, o operador via "não concluiu" enquanto o servidor
 *    ainda estava pedindo CEP.
 */

/** Prisma dublê: o `$transaction` reentra no próprio objeto, então o tipo vem antes. */
interface PrismaFake {
  [model: string]: Record<string, jest.Mock> | jest.Mock;
}

function servicoDeTeste(opts: {
  aoResolverLote?: jest.Mock;
  aoResolverDoCache?: jest.Mock;
}) {
  const ordem: string[] = [];
  const prisma: PrismaFake = {
    installationPending: {
      count: jest.fn().mockResolvedValue(0),
      createMany: jest.fn(() => {
        ordem.push('gravou');
        return Promise.resolve({ count: 0 });
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
    },
    device: { findMany: jest.fn().mockResolvedValue([]) },
    routeStop: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };

  const hinova = {
    authenticate: jest.fn().mockResolvedValue(undefined),
    // Duas páginas cheias e uma curta, pra dar tempo de observar quem roda
    // junto de quem. A pendência real vai na primeira página.
    listRawActiveVehicles: jest.fn(async (offset: number, limite: number) => {
      ordem.push(`veiculos:${offset}:inicio`);
      await new Promise((r) => setTimeout(r, 30));
      ordem.push(`veiculos:${offset}:fim`);
      if (offset >= limite * 2) return [];
      const pagina = Array.from({ length: limite }, (_, i) => ({
        codigo_veiculo: String(offset + i),
        codigo_associado: 'A1',
        placa: `RJA1A${offset + i}`,
        codigo_tipo_adesao: offset === 0 && i === 0 ? '1' : '2',
        data_contrato: '2026-08-01T00:00:00-0300',
        valor_fipe: 1000,
      }));
      return pagina;
    }),
    listRawActiveAssociates: jest.fn(async (offset: number, limite: number) => {
      ordem.push(`associados:${offset}:inicio`);
      await new Promise((r) => setTimeout(r, 30));
      ordem.push(`associados:${offset}:fim`);
      if (offset >= limite * 2) return [];
      return Array.from({ length: limite }, () => ({
        codigo_associado: 'A1',
        cidade: 'Rio',
        cep: '20000000',
        estado: 'RJ',
      }));
    }),
  };

  const geocoding = {
    resolverLote: opts.aoResolverLote ?? jest.fn().mockResolvedValue(new Map()),
    resolverDoCache:
      opts.aoResolverDoCache ?? jest.fn().mockResolvedValue(new Map()),
  };

  const service = new InstallationPendingsService(
    hinova as never,
    prisma as never,
    { get: jest.fn().mockReturnValue('true') } as never,
    geocoding as never,
    { sincronizar: jest.fn().mockResolvedValue({}) } as never,
  );

  return { service, ordem, geocoding, prisma };
}

describe('clique em Sincronizar', () => {
  it('varre veículos e associados em paralelo, não um depois do outro', async () => {
    const { service, ordem } = servicoDeTeste({});

    await service.sync('tenant-1');

    // Em série, a varredura de associados só começaria depois que a ÚLTIMA
    // página de veículos voltasse. Em paralelo, ela começa antes disso.
    const primeiroAssociado = ordem.indexOf('associados:0:inicio');
    const ultimaPaginaVeiculo = ordem.lastIndexOf('veiculos:10000:fim');
    expect(primeiroAssociado).toBeGreaterThanOrEqual(0);
    expect(ultimaPaginaVeiculo).toBeGreaterThanOrEqual(0);
    expect(primeiroAssociado).toBeLessThan(ultimaPaginaVeiculo);
  }, 30_000);

  it('não segura a gravação da fila esperando o geocoding pela rede', async () => {
    // Marca a ordem real dos eventos em vez de cronometrar: o relógio aqui é
    // dominado pela pausa de rate limit entre páginas, não pelo geocoding.
    const eventos: string[] = [];
    const redeLenta = jest.fn(async () => {
      eventos.push('geocoding-rede');
      await new Promise((r) => setTimeout(r, 50));
      return new Map();
    });
    const { service, prisma, geocoding } = servicoDeTeste({
      aoResolverLote: redeLenta as never,
    });
    const fila = prisma.installationPending as Record<string, jest.Mock>;
    fila.createMany.mockImplementation(() => {
      eventos.push('fila-gravada');
      return Promise.resolve({ count: 1 });
    });

    await service.sync('tenant-1');

    // A fila foi gravada; se a rede de geocoding rodou, foi DEPOIS disso.
    expect(eventos[0]).toBe('fila-gravada');
    expect(eventos.indexOf('geocoding-rede')).not.toBe(0);
    // E o cache local — que é instantâneo — continua alimentando a gravação.
    expect(geocoding.resolverDoCache).toHaveBeenCalled();
  }, 30_000);
});

describe('geocoding em segundo plano', () => {
  it('não roda duas vezes ao mesmo tempo', async () => {
    // Dois syncs seguidos (cron + clique do operador) não podem colocar duas
    // rodadas de geocoding na rede ao mesmo tempo: são as mesmas ~1.277
    // chamadas, e 429 no Nominatim derruba o endereço de todas as telas.
    let emVoo = 0;
    let simultaneidadeMax = 0;
    const resolverLote = jest.fn(async () => {
      emVoo++;
      simultaneidadeMax = Math.max(simultaneidadeMax, emVoo);
      await new Promise((r) => setTimeout(r, 300));
      emVoo--;
      return new Map();
    });

    const { service, prisma } = servicoDeTeste({
      aoResolverLote: resolverLote as never,
    });
    const fila = prisma.installationPending as Record<string, jest.Mock>;
    fila.findMany.mockResolvedValue([
      { id: 'p1', cep: '20000000', street: 'Rua Um', number: '1', city: 'Rio' },
    ]);

    const backgroundDe = (
      service as unknown as {
        resolverCoordenadasPendentes: (t: string) => Promise<void>;
      }
    ).resolverCoordenadasPendentes.bind(service);

    await Promise.all([backgroundDe('tenant-1'), backgroundDe('tenant-1')]);

    expect(simultaneidadeMax).toBe(1);
  }, 30_000);
});

describe('espelho cadastral fora da espera da tela', () => {
  it('o sync termina assim que a fila está gravada', async () => {
    // O espelho cadastral alimenta a busca por placa do vínculo de estoque,
    // não a tela de pendências. Enquanto ele estava dentro do `sync()`, o
    // badge "Sincronizando" ficava aceso por mais alguns minutos depois da
    // fila já estar pronta na tela.
    const eventos: string[] = [];
    const espelhoLento = jest.fn(async () => {
      eventos.push('espelho-comecou');
      await new Promise((r) => setTimeout(r, 3_000));
      eventos.push('espelho-terminou');
    });

    const { service, prisma } = servicoDeTeste({});
    (
      service as unknown as { mirror: { sincronizar: jest.Mock } }
    ).mirror.sincronizar = espelhoLento;
    const fila = prisma.installationPending as Record<string, jest.Mock>;
    fila.createMany.mockImplementation(() => {
      eventos.push('fila-gravada');
      return Promise.resolve({ count: 1 });
    });

    await service.sync('tenant-1');

    expect(eventos).toContain('fila-gravada');
    // O sync devolveu sem esperar os 3s do espelho.
    expect(eventos).not.toContain('espelho-terminou');
  }, 30_000);
});
