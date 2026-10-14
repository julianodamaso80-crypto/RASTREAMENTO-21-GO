/**
 * Rotas /app/vehicles/:id/*: sem associado ou tenant → 401 antes de qualquer
 * consulta (o Prisma ignoraria o filtro `undefined` e o `findFirst` por id
 * casaria veículo de qualquer associado). Com contexto válido e veículo de
 * outro associado, a resposta continua a de hoje (404).
 */
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AppDataService } from './app-data.service';

const BANCO = [
  { id: 'b1', associateId: 'B', tenantId: 't1', deletedAt: null, traccarDeviceId: 21, plate: 'BBB1B11', blockerAccessAllowed: true, appAccessBlocked: false },
];

function montar() {
  const findFirst = jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
    BANCO.find(
      (v) =>
        (where.id === undefined || v.id === where.id) &&
        (where.associateId === undefined || v.associateId === where.associateId) &&
        (where.tenantId === undefined || v.tenantId === where.tenantId) &&
        (where.deletedAt === undefined || v.deletedAt === where.deletedAt),
    ) ?? null,
  );
  const prisma: any = { vehicle: { findFirst, findMany: jest.fn(), update: jest.fn() } };
  const traccar: any = {
    getPositions: jest.fn().mockResolvedValue([]),
    getDevices: jest.fn().mockResolvedValue([]),
    sendCommandNow: jest.fn().mockResolvedValue({ enviado: true }),
  };
  const reports: any = {
    getTrips: jest.fn().mockResolvedValue([]),
    getJourney: jest.fn().mockResolvedValue({ date: '2026-10-14', trips: [] }),
    getHistoryReport: jest.fn().mockResolvedValue({ totals: {}, rows: [], days: [] }),
  };
  const service = new AppDataService(prisma, traccar, reports, {} as any);
  return { service, prisma, traccar, reports };
}

const ROTAS: [string, (s: AppDataService, a: any, t: any, id: string) => Promise<unknown>][] = [
  ['POST vehicles/:id/block', (s, a, t, id) => s.setBlocked(a, t, id, true)],
  ['POST vehicles/:id/unblock', (s, a, t, id) => s.setBlocked(a, t, id, false)],
  ['GET vehicles/:id/history', (s, a, t, id) => s.getHistory(a, t, id, '2026-10-14T00:00:00Z', '2026-10-14T23:59:59Z')],
  ['GET vehicles/:id/trips', (s, a, t, id) => s.getTrips(a, t, id, '2026-10-14T00:00:00Z', '2026-10-14T23:59:59Z')],
  ['GET vehicles/:id/journey', (s, a, t, id) => s.getJourney(a, t, id, '2026-10-14')],
  ['GET vehicles/:id/history-report', (s, a, t, id) => s.getHistoryReport(a, t, id, '2026-10-14T00:00:00Z', '2026-10-14T23:59:59Z', 'route')],
];

describe.each(ROTAS)('%s', (_rota, chamar) => {
  it.each([
    [undefined, 't1'],
    ['B', undefined],
    [undefined, undefined],
    ['', 't1'],
    ['B', ''],
  ])('contexto vazio (%p, %p) → 401 sem consultar banco, Traccar nem relatórios', async (a, t) => {
    const { service, prisma, traccar, reports } = montar();
    await expect(chamar(service, a, t, 'b1')).rejects.toThrow(UnauthorizedException);
    expect(prisma.vehicle.findFirst).not.toHaveBeenCalled();
    expect(prisma.vehicle.update).not.toHaveBeenCalled();
    for (const fn of [...Object.values(traccar), ...Object.values(reports)]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('contexto válido de A com veículo de B → 404, como hoje', async () => {
    const { service, traccar, reports } = montar();
    await expect(chamar(service, 'A', 't1', 'b1')).rejects.toThrow(NotFoundException);
    for (const fn of [...Object.values(traccar), ...Object.values(reports)]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('dono B em outro tenant → 404, como hoje', async () => {
    const { service } = montar();
    await expect(chamar(service, 'B', 't2', 'b1')).rejects.toThrow(NotFoundException);
  });
});
