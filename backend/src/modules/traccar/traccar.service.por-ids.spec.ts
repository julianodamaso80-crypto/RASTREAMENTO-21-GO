import { TraccarService } from './traccar.service';

/**
 * Consulta por lista de ids que NUNCA cai para a frota inteira: lista vazia ou
 * só com ids inválidos não chama o Traccar, e o que o Traccar devolver fora do
 * conjunto pedido é descartado.
 */

function servico(resposta: (url: string) => unknown[] = () => []) {
  const s = new TraccarService({ get: () => 'http://traccar.local' } as never);
  const get = jest
    .spyOn(
      (s as unknown as { client: { get: (url: string) => Promise<unknown> } })
        .client,
      'get',
    )
    .mockImplementation(async (url: string) => ({ data: resposta(url) }));
  return { s, get };
}

function idsDaUrl(url: string, chave: string): number[] {
  const [rota, query = ''] = url.split('?');
  expect(['/positions', '/devices']).toContain(rota);
  return new URLSearchParams(query).getAll(chave).map(Number);
}

describe.each([
  ['getPositionsDosDevices', 'deviceId', '/positions'] as const,
  ['getDevicesPorIds', 'id', '/devices'] as const,
])('TraccarService.%s', (metodo, chave, rota) => {
  const chamar = (s: TraccarService, ids: unknown[]) =>
    (s[metodo] as (ids: number[]) => Promise<unknown[]>)(ids as number[]);

  it('lista vazia → [] sem chamar o Traccar', async () => {
    const { s, get } = servico();
    await expect(chamar(s, [])).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it.each([[[0]], [[NaN]], [[-3]], [['7']], [[1.5]], [[undefined]], [[null]]])(
    'só ids inválidos %p → [] sem chamar o Traccar',
    async (ids) => {
      const { s, get } = servico();
      await expect(chamar(s, ids)).resolves.toEqual([]);
      expect(get).not.toHaveBeenCalled();
    },
  );

  it('pede exatamente os ids válidos, sem repetição, com parâmetro repetido', async () => {
    const { s, get } = servico();
    await chamar(s, [7, 0, 9, 7, NaN]);
    expect(get).toHaveBeenCalledTimes(1);
    const url = get.mock.calls[0][0] as string;
    expect(url.startsWith(`${rota}?`)).toBe(true);
    expect(idsDaUrl(url, chave)).toEqual([7, 9]);
  });

  it('descarta o que o Traccar devolver fora do conjunto pedido', async () => {
    const campo = chave === 'id' ? 'id' : 'deviceId';
    const { s } = servico(() => [{ [campo]: 7 }, { [campo]: 8 }, { [campo]: 9 }]);
    const r = (await chamar(s, [7, 9])) as Record<string, number>[];
    expect(r.map((x) => x[campo])).toEqual([7, 9]);
  });

  it('muitos ids → lotes de no máximo 100, nunca uma chamada sem filtro', async () => {
    const { s, get } = servico();
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    await chamar(s, ids);
    expect(get).toHaveBeenCalledTimes(3);
    const pedidos = get.mock.calls.map((c) => idsDaUrl(c[0] as string, chave));
    for (const lote of pedidos) {
      expect(lote.length).toBeGreaterThan(0);
      expect(lote.length).toBeLessThanOrEqual(100);
    }
    expect(pedidos.flat()).toEqual(ids);
  });

  it('falha do Traccar sobe como erro, sem consultar a frota inteira', async () => {
    const { s, get } = servico();
    get.mockRejectedValue(new Error('traccar fora'));
    jest
      .spyOn(s as unknown as { withRetry: (op: () => unknown) => unknown }, 'withRetry')
      .mockImplementation((op) => op());
    await expect(chamar(s, [7])).rejects.toThrow('traccar fora');
    for (const c of get.mock.calls) {
      expect(idsDaUrl(c[0] as string, chave)).toEqual([7]);
    }
  });
});
