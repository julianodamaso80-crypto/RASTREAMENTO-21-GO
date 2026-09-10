import { useEffect } from 'react';

/**
 * Aplica o `?busca=` da URL no filtro da tela, uma vez, na montagem.
 *
 * É o que faz o resultado da busca do topo cair já filtrado na tela de destino.
 * Lê de `window.location` em vez de `useSearchParams` de propósito: o hook do
 * Next obrigaria cada página a um limite de Suspense só por causa disto.
 *
 * Só na montagem: depois disso quem manda no campo é quem está digitando —
 * reagir à URL a cada render desfaria o que o operador acabou de escrever.
 */
export function useBuscaDaUrl(aplicar: (termo: string) => void) {
  useEffect(() => {
    const termo = new URLSearchParams(window.location.search).get('busca');
    if (termo?.trim()) aplicar(termo.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
