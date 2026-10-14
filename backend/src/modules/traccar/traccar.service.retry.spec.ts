import { TraccarService } from './traccar.service';

function servico() {
  const s = new TraccarService({ get: () => 'http://traccar.local' } as never);
  const client = (s as unknown as { client: { get: jest.Mock } }).client;
  client.get = jest.fn();
  const createSession = jest
    .spyOn(s, 'createSession')
    .mockResolvedValue(undefined);
  return { s, get: client.get, createSession };
}

const erroHttp = (status: number) => ({ response: { status } });

describe('TraccarService.withRetry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('414 não é repetido e não espera', async () => {
    const { s, get } = servico();
    get.mockRejectedValue(erroHttp(414));
    await expect(s.getServer()).rejects.toEqual(erroHttp(414));
    expect(get).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('503 continua sendo repetido com espera', async () => {
    const { s, get } = servico();
    get.mockRejectedValueOnce(erroHttp(503)).mockResolvedValueOnce({ data: 'ok' });
    const p = s.getServer();
    await jest.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe('ok');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('401 recria a sessão e repete', async () => {
    const { s, get, createSession } = servico();
    get.mockRejectedValueOnce(erroHttp(401)).mockResolvedValueOnce({ data: 'ok' });
    await expect(s.getServer()).resolves.toBe('ok');
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('TraccarService.getReportSummary', () => {
  it('frota grande (7.000 ids) → [] sem chamar o Traccar', async () => {
    const { s, get } = servico();
    const ids = Array.from({ length: 7000 }, (_, i) => 100000 + i);
    await expect(
      s.getReportSummary(ids, '2026-10-14T00:00:00Z', '2026-10-14T23:59:59Z'),
    ).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('100 ids → chama normalmente', async () => {
    const { s, get } = servico();
    get.mockResolvedValue({ data: [{ deviceId: 1 }] });
    const ids = Array.from({ length: 100 }, (_, i) => 1000 + i);
    await expect(
      s.getReportSummary(ids, '2026-10-14T00:00:00Z', '2026-10-14T23:59:59Z'),
    ).resolves.toEqual([{ deviceId: 1 }]);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
