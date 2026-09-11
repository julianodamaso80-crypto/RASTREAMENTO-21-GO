/**
 * Datas da agenda sempre no fuso do navegador. A API devolve ISO em UTC
 * ("...T19:00:00.000Z" é 16h em Brasília): cortar a string mostraria a hora
 * errada, então tudo passa por `Date`.
 */

const dois = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD local de uma data. */
export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

export function hojeIso(): string {
  return isoLocal(new Date());
}

/** Soma dias a um YYYY-MM-DD sem passar por UTC. */
export function somaDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  return isoLocal(new Date(a, m - 1, d + n));
}

/** Dias do período contando os dois extremos (07 a 07 = 1). */
export function diasEntre(inicio: string, fim: string): number {
  const [a1, m1, d1] = inicio.split('-').map(Number);
  const [a2, m2, d2] = fim.split('-').map(Number);
  const ms = new Date(a2, m2 - 1, d2).getTime() - new Date(a1, m1 - 1, d1).getTime();
  return Math.round(ms / 86400000) + 1;
}

/** Dia local (YYYY-MM-DD) de um ISO vindo da API. */
export function diaDoIso(iso: string): string {
  return isoLocal(new Date(iso));
}

/** Hora local (HH:mm) de um ISO vindo da API. */
export function horaDoIso(iso: string): string {
  const d = new Date(iso);
  return `${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** DD/MM/YYYY HH:mm, como a origem mostra no card da OS. */
export function dataHora(iso: string): string {
  const d = new Date(iso);
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()} ${horaDoIso(iso)}`;
}

/** DD/MM/YYYY de um YYYY-MM-DD. */
export function diaBr(dia: string): string {
  return dia.split('-').reverse().join('/');
}
