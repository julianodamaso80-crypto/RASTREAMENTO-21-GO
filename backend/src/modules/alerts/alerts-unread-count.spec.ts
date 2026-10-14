import { AlertsService } from './alerts.service';

function build(rows: Array<{ count: number }>) {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue(rows) };
  const service = new AlertsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { prisma, service };
}

describe('AlertsService.getUnreadCount', () => {
  it('marca capped quando atinge o teto', async () => {
    const { service } = build([{ count: 1000 }]);
    await expect(service.getUnreadCount('t-1')).resolves.toEqual({ count: 1000, capped: true });
  });

  it('não marca capped abaixo do teto', async () => {
    const { service } = build([{ count: 7 }]);
    await expect(service.getUnreadCount('t-1')).resolves.toEqual({ count: 7, capped: false });
  });

  it('usa LIMIT 1000, read = false e tenant como parâmetro', async () => {
    const { prisma, service } = build([{ count: 0 }]);
    await service.getUnreadCount('tenant-xyz');
    const q = prisma.$queryRaw.mock.calls[0][0] as { strings: string[]; values: unknown[] };
    const text = q.strings.join('?');
    expect(text).toContain('LIMIT 1000');
    expect(text).toContain('read = false');
    expect(text).not.toContain('tenant-xyz');
    expect(q.values).toContain('tenant-xyz');
  });
});
