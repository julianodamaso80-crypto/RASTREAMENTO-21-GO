/**
 * Equipamentos desenhados por vez na lista lateral do mapa do estoque.
 * Medido em 14/10/2026 (painel local, 90 s): 7.654 cards na lista davam ~108
 * mil nós no DOM e long tasks de 13 a 20 s, re-renderizados a cada payload de
 * 15 s. A busca, os filtros e as contagens agem sobre a lista inteira — só o
 * que é desenhado é limitado.
 */
export const ITENS_POR_VEZ = 200;

export function janelaDaLista<T>(
  lista: T[],
  visiveis: number,
): { itens: T[]; restantes: number } {
  return {
    itens: lista.slice(0, visiveis),
    restantes: Math.max(0, lista.length - visiveis),
  };
}
