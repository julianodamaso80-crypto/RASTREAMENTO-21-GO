import { InstallationPendingsService } from './installation-pendings.service';
import type { HinovaRawAssociate, HinovaRawVehicle } from '../hinova/hinova.interface';

/**
 * A gravação da fila estourou o timeout de transação do Prisma em produção
 * (02/09/2026, 20:45 UTC):
 *
 *   "A commit cannot be executed on an expired transaction. The timeout for
 *    this transaction was 5000 ms, however 9167 ms passed since the start"
 *
 * O sync agendado abortou inteiro: nada gravado, espelho cadastral nem rodou.
 * A causa é a forma em array do `$transaction`, que só aceita `isolationLevel`
 * — o timeout dela vem do default global de 5s do PrismaClient e não pode ser
 * afrouxado na chamada.
 *
 * Aqui o fake do Prisma reproduz esse relógio: a transação recebe um limite e
 * estoura se a gravação passar dele.
 */

const MS_GRAVACAO_REAL = 9_167; // medido em produção
const TIMEOUT_PADRAO_PRISMA = 5_000;

function veiculoPendente(codigo: string): HinovaRawVehicle {
  return {
    codigo_veiculo: codigo,
    codigo_associado: 'A1',
    placa: `RJA0A0${codigo}`,
    chassi: `9BD376AJDTYKB30${codigo}`,
    codigo_tipo_adesao: '1',
    data_contrato: '2026-08-01T00:00:00-0300',
    marca: 'HONDA',
    modelo: 'CG 160',
    nome_associado: 'FULANO',
    valor_fipe: 10000,
  };
}

const associado: HinovaRawAssociate = {
  codigo_associado: 'A1',
  cidade: 'Rio de Janeiro',
  bairro: 'Centro',
  cep: '20000000',
  logradouro: 'Rua Um',
  numero: '10',
  estado: 'RJ',
};

interface PrismaFake {
  gravadas: unknown[];
  installationPending: Record<string, jest.Mock>;
  device: Record<string, jest.Mock>;
  routeStop: Record<string, jest.Mock>;
  $transaction: jest.Mock;
}

/** Prisma mínimo: só o que o sync toca, com o relógio da transação. */
function prismaFake(): PrismaFake {
  const gravadas: unknown[] = [];
  const fake: PrismaFake = {
    gravadas,
    installationPending: {
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn((args: { data: unknown[] }) => {
        gravadas.push(...args.data);
        return Promise.resolve({ count: args.data.length });
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    device: { findMany: jest.fn().mockResolvedValue([]) },
    routeStop: { findMany: jest.fn().mockResolvedValue([]) },
    // Espelha o comportamento real: o limite vale para o bloco inteiro e a
    // gravação da fila custa MS_GRAVACAO_REAL.
    $transaction: jest.fn(
      async (arg: unknown, options?: { timeout?: number }) => {
        const limite = options?.timeout ?? TIMEOUT_PADRAO_PRISMA;
        if (MS_GRAVACAO_REAL > limite) {
          throw new Error(
            'Invalid `prisma.installationPending.deleteMany()` invocation: ' +
              'Transaction API error: A commit cannot be executed on an expired ' +
              `transaction. The timeout for this transaction was ${limite} ms, ` +
              `however ${MS_GRAVACAO_REAL} ms passed since the start of the transaction.`,
          );
        }
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => Promise<unknown>)(fake);
        }
        return Promise.all(arg as Promise<unknown>[]);
      },
    ),
  };
  return fake;
}

let prisma: PrismaFake;

function montarService() {
  prisma = prismaFake();
  const hinova = {
    authenticate: jest.fn().mockResolvedValue(undefined),
    listRawActiveVehicles: jest.fn((offset: number) =>
      Promise.resolve(offset === 0 ? [veiculoPendente('1')] : []),
    ),
    listRawActiveAssociates: jest.fn((offset: number) =>
      Promise.resolve(offset === 0 ? [associado] : []),
    ),
  };
  const config = { get: jest.fn().mockReturnValue('true') };
  const geocoding = { resolverLote: jest.fn().mockResolvedValue(new Map()) };
  const mirror = { sincronizar: jest.fn().mockResolvedValue({ total: 0, porSituacao: {} }) };

  return new InstallationPendingsService(
    hinova as never,
    prisma as never,
    config as never,
    geocoding as never,
    mirror as never,
  );
}

describe('sync de pendências — gravação da fila', () => {
  it('conclui mesmo quando a gravação passa dos 5s default do Prisma', async () => {
    const service = montarService();

    const resultado = await service.sync('tenant-1');

    expect(resultado.total).toBe(1);
    expect(prisma.gravadas).toHaveLength(1);
  });

  it('pede um limite de transação maior que o tempo real de gravação', async () => {
    const service = montarService();

    await service.sync('tenant-1');

    const limites = prisma.$transaction.mock.calls.map(
      (chamada: unknown[]) =>
        (chamada[1] as { timeout?: number } | undefined)?.timeout ?? 0,
    );
    expect(limites.some((t: number) => t > MS_GRAVACAO_REAL)).toBe(true);
  });
});
