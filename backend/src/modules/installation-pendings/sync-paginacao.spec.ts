import { InstallationPendingsService } from './installation-pendings.service';
import { SgaMirrorService } from './sga-mirror.service';

/**
 * O sync pedia 1.000 registros por página quando o SGA entrega 5.000.
 *
 * Medido contra a API real em 03/09/2026:
 *   - `quantidade_por_pagina` 1.000 → 6,5s por página · 27 páginas pros 26.449
 *     veículos ativos · 26 pausas de 2,5s = 240s
 *   - `quantidade_por_pagina` 5.000 → 23s por página · 6 páginas · 5 pausas = 141s
 *   - `quantidade_por_pagina` 10.000 e 30.000 → HTTP 406
 *
 * 5.000 é o teto do SGA e o default documentado no apidoc (`/listar/veiculo` e
 * `/listar/associado`). Pedir menos só multiplica round-trip e pausa de rate
 * limit: nos associados são outros 88s jogados fora, e na situação 2 do espelho
 * (10.984 inativos) 90s viram 50s.
 *
 * Os testes contam PÁGINAS, não leem constante: o que importa é quantas idas ao
 * SGA a varredura faz.
 */

/** Prisma dublê: o `$transaction` reentra no próprio objeto, então o tipo vem antes. */
interface PrismaFake {
  [model: string]: Record<string, jest.Mock> | jest.Mock;
}

/** Fake do SGA: devolve páginas do tamanho pedido até acabar o total. */
function paginador(total: number, registro: () => unknown = () => ({})) {
  const offsets: number[] = [];
  const fn = jest.fn((offset: number, limite: number) => {
    offsets.push(offset);
    const restam = Math.max(0, total - offset);
    return Promise.resolve(
      Array.from({ length: Math.min(limite, restam) }, registro),
    );
  });
  return { offsets, fn };
}

describe('paginação do sync do SGA', () => {
  it('varre os 26.449 veículos ativos em 6 páginas, não em 27', async () => {
    const veiculos = paginador(26449);
    const prisma: PrismaFake = {
      installationPending: {
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      device: { findMany: jest.fn().mockResolvedValue([]) },
      routeStop: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };
    const service = new InstallationPendingsService(
      {
        authenticate: jest.fn().mockResolvedValue(undefined),
        listRawActiveVehicles: veiculos.fn,
        listRawActiveAssociates: jest.fn(() => Promise.resolve([])),
      } as never,
      prisma as never,
      { get: jest.fn().mockReturnValue('true') } as never,
      {
        resolverLote: jest.fn().mockResolvedValue(new Map()),
        resolverDoCache: jest.fn().mockResolvedValue(new Map()),
      } as never,
      { sincronizar: jest.fn().mockResolvedValue({}) } as never,
    );

    await service.sync('tenant-1');

    expect(veiculos.offsets).toEqual([0, 5000, 10000, 15000, 20000, 25000]);
  }, 60_000);

  it('varre os 10.984 inativos do espelho em 3 páginas, não em 11', async () => {
    // Só a situação 2 tem volume; as outras respondem uma página curta.
    const porSituacao: Record<number, number> = {
      1: 0,
      2: 10984,
      3: 27,
      4: 631,
      5: 13,
    };
    const offsets: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };

    const hinova = {
      listRawVehiclesBySituation: jest.fn(
        (situacao: number, offset: number, limite: number) => {
          offsets[situacao].push(offset);
          const restam = Math.max(0, porSituacao[situacao] - offset);
          return Promise.resolve(
            Array.from({ length: Math.min(limite, restam) }, (_, i) => ({
              codigo_veiculo: String(offset + i),
              placa: `AAA${offset + i}`,
            })),
          );
        },
      ),
    };
    const prisma: PrismaFake = {
      sgaVehicle: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      vehicle: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };

    const mirror = new SgaMirrorService(hinova as never, prisma as never);
    await mirror.sincronizar('tenant-1');

    expect(offsets[2]).toEqual([0, 5000, 10000]);
  }, 60_000);
});
