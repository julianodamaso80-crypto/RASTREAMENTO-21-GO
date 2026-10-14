import { CacheCompartilhado } from './cache-compartilhado';

/** Promessa controlada de fora, pra decidir quando a montagem termina. */
function adiada<T>() {
  let resolver!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

const OPCOES = { maxEntradas: 50, timeoutMs: 30_000 };

describe('CacheCompartilhado', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('20 chamadas simultâneas da mesma chave montam 1× e todas recebem o mesmo valor', async () => {
    const cache = new CacheCompartilhado<{ n: number }>(OPCOES);
    const pendente = adiada<{ n: number }>();
    const montar = jest.fn(() => pendente.promessa);

    const chamadas = Array.from({ length: 20 }, () =>
      cache.obter('t1', 10_000, montar),
    );
    pendente.resolver({ n: 1 });
    const valores = await Promise.all(chamadas);

    expect(montar).toHaveBeenCalledTimes(1);
    for (const v of valores) expect(v).toBe(valores[0]);
    expect(valores[0]).toEqual({ n: 1 });
  });

  it('chaves diferentes montam separadamente', async () => {
    const cache = new CacheCompartilhado<string>(OPCOES);
    const montar = jest.fn((chave: string) =>
      Promise.resolve(`valor-${chave}`),
    );

    const [a, b] = await Promise.all([
      cache.obter('t1', 10_000, () => montar('t1')),
      cache.obter('t2', 10_000, () => montar('t2')),
    ]);

    expect(montar).toHaveBeenCalledTimes(2);
    expect(a).toBe('valor-t1');
    expect(b).toBe('valor-t2');
  });

  it('dentro do ttl devolve sem montar; depois do ttl monta de novo', async () => {
    const cache = new CacheCompartilhado<number>(OPCOES);
    let n = 0;
    const montar = jest.fn(() => Promise.resolve(++n));

    expect(await cache.obter('t1', 10_000, montar)).toBe(1);
    jest.advanceTimersByTime(9_999);
    expect(await cache.obter('t1', 10_000, montar)).toBe(1);
    jest.advanceTimersByTime(1);
    expect(await cache.obter('t1', 10_000, montar)).toBe(2);
    expect(montar).toHaveBeenCalledTimes(2);
  });

  it('ttl por função: resultado degradado dura menos', async () => {
    const cache = new CacheCompartilhado<{ ok: boolean }>(OPCOES);
    const ttl = (v: { ok: boolean }) => (v.ok ? 10_000 : 3_000);
    const ruim = jest.fn(() => Promise.resolve({ ok: false }));
    const bom = jest.fn(() => Promise.resolve({ ok: true }));

    await cache.obter('ruim', ttl, ruim);
    await cache.obter('bom', ttl, bom);
    jest.advanceTimersByTime(3_000);
    await cache.obter('ruim', ttl, ruim);
    await cache.obter('bom', ttl, bom);

    expect(ruim).toHaveBeenCalledTimes(2);
    expect(bom).toHaveBeenCalledTimes(1);
  });

  it('invalidar faz a próxima obter montar de novo', async () => {
    const cache = new CacheCompartilhado<number>(OPCOES);
    let n = 0;
    const montar = jest.fn(() => Promise.resolve(++n));

    await cache.obter('t1', 10_000, montar);
    cache.invalidar('t1');
    expect(await cache.obter('t1', 10_000, montar)).toBe(2);
    expect(montar).toHaveBeenCalledTimes(2);
  });

  it('montagem iniciada antes de invalidar é entregue a quem esperava, mas não fica gravada', async () => {
    const cache = new CacheCompartilhado<string>(OPCOES);
    const velha = adiada<string>();
    const montarVelha = jest.fn(() => velha.promessa);
    const montarNova = jest.fn(() => Promise.resolve('nova'));

    const esperando = cache.obter('t1', 10_000, montarVelha);
    cache.invalidar('t1');
    velha.resolver('velha');

    expect(await esperando).toBe('velha');
    expect(await cache.obter('t1', 10_000, montarNova)).toBe('nova');
    expect(montarNova).toHaveBeenCalledTimes(1);
  });

  it('chamada feita depois de invalidar não pega carona na montagem velha', async () => {
    const cache = new CacheCompartilhado<string>(OPCOES);
    const velha = adiada<string>();
    const montarNova = jest.fn(() => Promise.resolve('nova'));

    const esperando = cache.obter('t1', 10_000, () => velha.promessa);
    cache.invalidar('t1');
    const depois = cache.obter('t1', 10_000, montarNova);
    velha.resolver('velha');

    expect(await esperando).toBe('velha');
    expect(await depois).toBe('nova');
    // a nova ficou gravada; a velha, que terminou depois, não sobrescreveu
    expect(await cache.obter('t1', 10_000, montarNova)).toBe('nova');
    expect(montarNova).toHaveBeenCalledTimes(1);
  });

  it('erro de montar rejeita todos os que esperavam e não fica gravado', async () => {
    const cache = new CacheCompartilhado<string>(OPCOES);
    const pendente = adiada<string>();
    const montar = jest.fn(() => pendente.promessa);

    const chamadas = Array.from({ length: 5 }, () =>
      cache.obter('t1', 10_000, montar),
    );
    pendente.rejeitar(new Error('traccar fora'));
    for (const c of chamadas) await expect(c).rejects.toThrow('traccar fora');
    expect(montar).toHaveBeenCalledTimes(1);

    const recuperou = jest.fn(() => Promise.resolve('ok'));
    expect(await cache.obter('t1', 10_000, recuperou)).toBe('ok');
    expect(recuperou).toHaveBeenCalledTimes(1);
    expect(cache.tamanho()).toBe(1);
  });

  it('estouro de timeoutMs rejeita e a chamada seguinte monta de novo', async () => {
    const cache = new CacheCompartilhado<string>({
      maxEntradas: 50,
      timeoutMs: 1_000,
    });
    const travada = adiada<string>();

    const esperando = cache.obter('t1', 10_000, () => travada.promessa);
    jest.advanceTimersByTime(1_000);
    await expect(esperando).rejects.toThrow('cache: montagem excedeu 1000 ms');

    const montarDeNovo = jest.fn(() => Promise.resolve('ok'));
    expect(await cache.obter('t1', 10_000, montarDeNovo)).toBe('ok');
    expect(montarDeNovo).toHaveBeenCalledTimes(1);

    // a montagem travada que terminar depois não sobrescreve nada
    travada.resolver('atrasada');
    await Promise.resolve();
    expect(await cache.obter('t1', 10_000, montarDeNovo)).toBe('ok');
  });

  it('maxEntradas: 2 com 3 chaves despeja a menos recente', async () => {
    const cache = new CacheCompartilhado<string>({
      maxEntradas: 2,
      timeoutMs: 30_000,
    });
    const montar = jest.fn((c: string) => Promise.resolve(c));

    await cache.obter('a', 10_000, () => montar('a'));
    await cache.obter('b', 10_000, () => montar('b'));
    // ler 'a' faz dela a mais recente; 'b' vira a candidata ao despejo
    await cache.obter('a', 10_000, () => montar('a'));
    await cache.obter('c', 10_000, () => montar('c'));

    expect(cache.tamanho()).toBe(2);
    expect(montar).toHaveBeenCalledTimes(3);
    await cache.obter('a', 10_000, () => montar('a'));
    expect(montar).toHaveBeenCalledTimes(3);
    await cache.obter('b', 10_000, () => montar('b'));
    expect(montar).toHaveBeenCalledTimes(4);
  });
});
