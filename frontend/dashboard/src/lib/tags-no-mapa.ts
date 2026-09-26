import type { TagNoMapa } from '@/types/tag-map';

/** Filtro da aba: todos, um estado do rastreador, ou só as TAGs. */
export type FiltroDoMapa = 'all' | 'tag' | 'ignition_on' | 'ignition_off' | 'offline' | 'alert';

/**
 * A TAG entra no "Todos" e na aba "TAG". Nas abas de estado do rastreador
 * (Ligado, Desligado, GPS com defeito, Bloqueado) ela NÃO entra: a TAG não
 * mede nada disso, e pôr uma TAG em "Desligado" seria afirmar o que ninguém
 * mediu.
 */
export function tagsDaAba(
  tags: TagNoMapa[],
  filtro: FiltroDoMapa,
  buscando = false,
): TagNoMapa[] {
  if (filtro === 'tag') return tags;
  if (filtro !== 'all') return [];
  // Em "Todos" a TAG de carro com rastreador só entra quando o operador a
  // procura: sem busca, o carro já está ali pelo rastreador e o total de
  // "Todos" continua igual ao de Clientes Ativos.
  return buscando ? tags : tags.filter((t) => !t.comRastreador);
}

/** A busca da TAG cobre o que o operador tem em mãos: placa, nome e número. */
export function tagCasaBusca(tag: TagNoMapa, termo: string): boolean {
  const t = termo.trim();
  if (!t) return true;
  const alfa = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (alfa && tag.plate.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(alfa)) return true;
  if (tag.associateName.toLowerCase().includes(t.toLowerCase())) return true;
  // Termo com letra nunca vira busca numérica (mesma regra do backend).
  const digitos = t.replace(/\D/g, '');
  return !/[A-Za-z]/.test(t) && digitos.length >= 3 && tag.serialNumber.includes(digitos);
}
