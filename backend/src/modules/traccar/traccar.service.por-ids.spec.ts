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

describe('TraccarService.getDevicesPorIds', () => {
  const chave = 'id';
  const rota = '/devices';
  const chamar = (s: TraccarService, ids: unknown[]) =>
    s.getDevicesPorIds(ids as number[]) as Promise<unknown[]>;

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
    const campo = 'id';
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

/**
 * O `/positions` do Traccar aceita UM `deviceId` (`@QueryParam("deviceId") long`);
 * repetido, só um vale. `id` é lista: a posição é buscada pelo `positionId`
 * que o device carrega.
 */
describe('TraccarService.getPositionsDosDevices', () => {
  // Traccar simulado: device N tem positionId N*100 (0 = sem posição ainda).
  const SEM_POSICAO = new Set([13]);
  const traccar = (url: string): unknown[] => {
    const [rota, query = ''] = url.split('?');
    const ids = new URLSearchParams(query).getAll('id').map(Number);
    if (rota === '/devices') {
      return ids.map((id) => ({ id, positionId: SEM_POSICAO.has(id) ? 0 : id * 100 }));
    }
    return ids.map((id) => ({ id, deviceId: id / 100 }));
  };

  it('lista vazia ou só ids inválidos → [] sem chamar o Traccar', async () => {
    const { s, get } = servico(traccar);
    await expect(s.getPositionsDosDevices([])).resolves.toEqual([]);
    await expect(s.getPositionsDosDevices([0, NaN, -1, 1.5])).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('devices primeiro, depois /positions com a LISTA de positionId em `id`, nunca `deviceId`', async () => {
    const { s, get } = servico(traccar);
    const r = await s.getPositionsDosDevices([7, 9, 7]);
    expect(r.map((p) => p.deviceId)).toEqual([7, 9]);
    const urls = get.mock.calls.map((c) => c[0] as string);
    expect(urls).toHaveLength(2);
    expect(urls[0].startsWith('/devices?')).toBe(true);
    expect(idsDaUrl(urls[0], 'id')).toEqual([7, 9]);
    expect(urls[1].startsWith('/positions?')).toBe(true);
    expect(idsDaUrl(urls[1], 'id')).toEqual([700, 900]);
    for (const u of urls) expect(u).not.toContain('deviceId');
  });

  it('device sem positionId → sem posição (e sem /positions se nenhum tiver)', async () => {
    const { s, get } = servico(traccar);
    await expect(s.getPositionsDosDevices([13])).resolves.toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
    const r = await s.getPositionsDosDevices([13, 7]);
    expect(r.map((p) => p.deviceId)).toEqual([7]);
  });

  it('devices já buscados → uma ida só, a de /positions', async () => {
    const { s, get } = servico(traccar);
    const devices = [
      { id: 7, positionId: 700 },
      { id: 9, positionId: 900 },
    ] as never[];
    const r = await s.getPositionsDosDevices([7, 9], devices);
    expect(r.map((p) => p.deviceId)).toEqual([7, 9]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(idsDaUrl(get.mock.calls[0][0] as string, 'id')).toEqual([700, 900]);
  });

  it('device não pedido na lista recebida e posição de outro device são descartados', async () => {
    const { s, get } = servico((url) =>
      url.startsWith('/positions')
        ? [
            { id: 700, deviceId: 7 },
            { id: 800, deviceId: 8 },
            { id: 900, deviceId: 21 },
          ]
        : [],
    );
    const devices = [
      { id: 7, positionId: 700 },
      { id: 8, positionId: 800 }, // não pedido
      { id: 9, positionId: 900 }, // Traccar devolve a 900 com deviceId de outro
    ] as never[];
    const r = await s.getPositionsDosDevices([7, 9], devices);
    expect(r.map((p) => p.deviceId)).toEqual([7]);
    expect(idsDaUrl(get.mock.calls[0][0] as string, 'id')).toEqual([700, 900]);
  });

  it('muitos devices → /positions em lotes de no máximo 100 ids', async () => {
    const { s, get } = servico(traccar);
    const ids = Array.from({ length: 250 }, (_, i) => i + 1).filter((i) => !SEM_POSICAO.has(i));
    const r = await s.getPositionsDosDevices(ids);
    expect(r).toHaveLength(ids.length);
    const lotes = get.mock.calls
      .map((c) => c[0] as string)
      .filter((u) => u.startsWith('/positions'))
      .map((u) => idsDaUrl(u, 'id'));
    expect(lotes).toHaveLength(3);
    for (const l of lotes) expect(l.length).toBeLessThanOrEqual(100);
  });
});
