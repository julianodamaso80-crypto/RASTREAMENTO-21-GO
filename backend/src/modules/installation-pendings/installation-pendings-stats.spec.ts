import { InstallationPendingsService } from './installation-pendings.service';

/**
 * Os cards de Pendências somavam 11.359 linhas no Node (findMany de tudo +
 * filter/reduce) a cada troca de filtro. Agora é uma agregação no Postgres.
 */
describe('InstallationPendingsService.stats — agregado no banco', () => {
  it('conta por tipo e soma o valor protegido sem trazer as linhas', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { pendingType: 'TRACKER', _count: { _all: 7000 }, _sum: { protectedValue: 123456.78 } },
      { pendingType: 'TAG', _count: { _all: 4359 }, _sum: { protectedValue: 1000.5 } },
    ]);
    const findMany = jest.fn();
    const prisma = {
      installationPending: {
        groupBy,
        findMany,
        findFirst: jest.fn().mockResolvedValue({ syncedAt: new Date('2026-10-14T10:00:00Z') }),
      },
    };
    const s = new InstallationPendingsService(
      {} as never,
      prisma as never,
      { get: () => undefined } as never,
      {} as never,
      {} as never,
    );
    const r = await s.stats('t1', 30);
    expect(r).toMatchObject({
      total: 11359,
      tracker: 7000,
      tag: 4359,
      exposedValue: 124457.28,
      lastSyncAt: '2026-10-14T10:00:00.000Z',
    });
    expect(findMany).not.toHaveBeenCalled();
    const args = groupBy.mock.calls[0][0];
    expect(args.by).toEqual(['pendingType']);
    expect(args.where.tenantId).toBe('t1');
    expect(args.where.contractDate.gte).toBeInstanceOf(Date);
  });

  it('sem pendências: zeros e lastSyncAt null', async () => {
    const prisma = {
      installationPending: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const s = new InstallationPendingsService({} as never, prisma as never, { get: () => undefined } as never, {} as never, {} as never);
    expect(await s.stats('t1', 7)).toMatchObject({ total: 0, tracker: 0, tag: 0, exposedValue: 0, lastSyncAt: null });
  });
});
