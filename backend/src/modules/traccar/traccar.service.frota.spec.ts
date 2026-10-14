import { TraccarService } from './traccar.service';

/**
 * `frotaBuscadaEm` diz quando começou a busca da lista completa que o
 * coalesce de 2 s está servindo, para quem guarda a frota por cima dele
 * medir a idade a partir do Traccar, e não da própria montagem.
 */

const T0 = Date.parse('2026-10-13T15:00:00Z');

function servico() {
  const s = new TraccarService({ get: () => 'http://traccar.local' } as never);
  const get = jest
    .spyOn(
      (s as unknown as { client: { get: (url: string) => Promise<unknown> } })
        .client,
      'get',
    )
    .mockResolvedValue({ data: [] });
  return { s, get };
}

describe('TraccarService.frotaBuscadaEm', () => {
  beforeEach(() => jest.useFakeTimers({ now: T0 }));
  afterEach(() => jest.useRealTimers());

  it('sem busca → null', () => {
    const { s } = servico();
    expect(s.frotaBuscadaEm('/devices')).toBeNull();
    expect(s.frotaBuscadaEm('/positions')).toBeNull();
  });

  it('devolve o início da busca vigente de cada rota', async () => {
    const { s, get } = servico();
    await s.getDevices();
    jest.setSystemTime(T0 + 700);
    await s.getPositions();
    expect(s.frotaBuscadaEm('/devices')).toBe(T0);
    expect(s.frotaBuscadaEm('/positions')).toBe(T0 + 700);

    // Dentro dos 2 s o coalesce serve a mesma busca: o instante não muda.
    jest.setSystemTime(T0 + 1_500);
    await s.getDevices();
    expect(get).toHaveBeenCalledTimes(2);
    expect(s.frotaBuscadaEm('/devices')).toBe(T0);
  });

  it('busca vencida → null; nova busca → novo instante', async () => {
    const { s } = servico();
    await s.getDevices();
    jest.setSystemTime(T0 + 2_000);
    expect(s.frotaBuscadaEm('/devices')).toBeNull();
    await s.getDevices();
    expect(s.frotaBuscadaEm('/devices')).toBe(T0 + 2_000);
  });

  it('consulta por device ou período não conta', async () => {
    const { s } = servico();
    await s.getPositions(7, 'a', 'b');
    expect(s.frotaBuscadaEm('/positions')).toBeNull();
  });
});
