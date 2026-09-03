import { GeocodingService } from './geocoding.service';

/**
 * CEP que nenhuma fonte resolve não pode ser retentado a cada sync.
 *
 * Medido em produção em 03/09/2026: 1.277 CEPs distintos da fila estavam fora
 * do `cep_coordinates` e voltavam à rede em toda passada. Como a falha nunca
 * era gravada, o custo se repetia: ~160 ms de pausa + a chamada à AwesomeAPI
 * (que responde 429 QuotaExceeded — as 5.793 linhas do cache são TODAS do
 * Nominatim, nenhuma dela) + 1.100 ms de pausa do Nominatim + a chamada. Dá
 * cerca de 32 minutos por sync gastos em CEP que já se sabe que não resolve —
 * o maior item do tempo total, que a operação vê como "demora demais".
 */
describe('geocoding — CEP que não resolve', () => {
  const CEP = '23000123';

  function prismaFake() {
    const falhas = new Map<string, { attempts: number; lastTriedAt: Date }>();
    return {
      falhas,
      cepCoordinate: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      cepGeocodeFailure: {
        findMany: jest.fn(() =>
          Promise.resolve(
            [...falhas.entries()].map(([cep, f]) => ({ cep, ...f })),
          ),
        ),
        upsert: jest.fn((args: { where: { cep: string } }) => {
          const atual = falhas.get(args.where.cep);
          falhas.set(args.where.cep, {
            attempts: (atual?.attempts ?? 0) + 1,
            lastTriedAt: new Date(),
          });
          return Promise.resolve({});
        }),
      },
    };
  }

  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    // Nenhuma fonte resolve: AwesomeAPI em 429, Nominatim sem resultado.
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation((url: RequestInfo | URL) =>
        Promise.resolve(
          String(url).includes('awesomeapi')
            ? ({ ok: false, status: 429 } as Response)
            : ({ ok: true, json: () => Promise.resolve([]) } as unknown as Response),
        ),
      );
  });

  afterEach(() => fetchSpy.mockRestore());

  it('não volta à rede pelo mesmo CEP no sync seguinte', async () => {
    const prisma = prismaFake();
    const service = new GeocodingService(prisma as never);
    const endereco = [
      { cep: CEP, street: 'Rua Que Não Existe', number: '1', city: 'Queimados', state: 'RJ' },
    ];

    await service.resolverLote(endereco);
    const chamadasPrimeiroSync = fetchSpy.mock.calls.length;
    expect(chamadasPrimeiroSync).toBeGreaterThan(0);

    await service.resolverLote(endereco);

    expect(fetchSpy.mock.calls.length).toBe(chamadasPrimeiroSync);
  }, 20_000);
});
