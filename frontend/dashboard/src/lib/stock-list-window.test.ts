import { ITENS_POR_VEZ, janelaDaLista } from './stock-list-window';

const nums = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('janelaDaLista', () => {
  it('mostra 200 por vez e conta os restantes', () => {
    expect(ITENS_POR_VEZ).toBe(200);
    const r = janelaDaLista(nums(7654), ITENS_POR_VEZ);
    expect(r.itens).toHaveLength(200);
    expect(r.itens[0]).toBe(0);
    expect(r.restantes).toBe(7454);
  });

  it('lista menor que a janela devolve tudo e zero restantes', () => {
    const r = janelaDaLista(nums(30), 200);
    expect(r.itens).toHaveLength(30);
    expect(r.restantes).toBe(0);
  });

  it('janela maior que a lista não fica negativa', () => {
    expect(janelaDaLista(nums(5), 400).restantes).toBe(0);
  });

  it('"mostrar mais" acumula a janela', () => {
    const r = janelaDaLista(nums(450), 400);
    expect(r.itens).toHaveLength(400);
    expect(r.restantes).toBe(50);
  });
});
