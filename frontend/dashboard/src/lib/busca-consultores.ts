import type { Consultant } from '@/types/consultant';

/**
 * Busca da aba Consultores: por relevância e tolerante à grafia.
 *
 * Achado de 17/09/2026 (dono, com print): "leticya" casava com 1 nome e com 87
 * fichas pelo "quem chamou" (a equipe dela). Em ordem alfabética a própria
 * Leticya sumia no meio da equipe e parecia que a busca não funcionava. Por isso
 * o nome vem primeiro, e quem entrou só por "quem chamou" diz o motivo.
 */

/** Conectivos de nome não ajudam a achar ninguém e casam com metade da base. */
const PALAVRAS_VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * Deixa iguais as grafias que a pessoa digita trocadas: acento, y/i, ph/f, th/t,
 * k/c, w/v e letra dobrada ("Leticya" = "leticia", "Thiago" = "tiago").
 */
export function normalizar(texto: string | null | undefined): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/y/g, 'i')
    .replace(/k/g, 'c')
    .replace(/w/g, 'v')
    .replace(/([a-z])\1+/g, '$1');
}

/** Só sem acento e minúsculo: serve para premiar quem digitou a grafia exata. */
function literal(texto: string | null | undefined): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function palavras(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9@._-]+/)
    .filter((p) => p && !PALAVRAS_VAZIAS.has(p));
}

export type MotivoBusca = 'quem-chamou' | 'cooperativa' | 'filial';

export interface ResultadoBusca {
  consultor: Consultant;
  pontos: number;
  /** Preenchido quando o termo NÃO estava no nome, tratamento, e-mail ou número. */
  motivo: MotivoBusca | null;
}

interface Indexado {
  c: Consultant;
  nome: string;
  nomeLiteral: string;
  nomePalavras: string[];
  tratamento: string;
  tratamentoPalavras: string[];
  email: string;
  chamou: string;
  chamouPalavras: string[];
  cooperativa: string;
  filial: string;
  numeros: string[];
}

/** Normaliza a base uma vez só; digitar não refaz esse trabalho. */
export function indexar(lista: Consultant[]): Indexado[] {
  return lista.map((c) => ({
    c,
    nome: normalizar(c.name),
    nomeLiteral: literal(c.name),
    nomePalavras: palavras(c.name),
    tratamento: normalizar(c.nickname),
    tratamentoPalavras: palavras(c.nickname ?? ''),
    email: normalizar(c.email),
    chamou: normalizar(c.managerName),
    chamouPalavras: palavras(c.managerName ?? ''),
    cooperativa: normalizar(c.cooperative),
    filial: normalizar(c.branch),
    numeros: [c.mobile, c.phone, c.document].filter((v): v is string => !!v),
  }));
}

type Campo = { pontos: number; motivo: MotivoBusca | null };

function pontuarPalavra(x: Indexado, termo: string): Campo | null {
  const comeca = (ps: string[]) => ps.some((p) => p.startsWith(termo));
  if (x.nomePalavras[0]?.startsWith(termo)) return { pontos: 100, motivo: null };
  if (comeca(x.nomePalavras)) return { pontos: 80, motivo: null };
  if (comeca(x.tratamentoPalavras)) return { pontos: 60, motivo: null };
  if (x.nome.includes(termo)) return { pontos: 50, motivo: null };
  if (x.email.includes(termo)) return { pontos: 45, motivo: null };
  if (x.tratamento.includes(termo)) return { pontos: 40, motivo: null };
  if (comeca(x.chamouPalavras)) return { pontos: 20, motivo: 'quem-chamou' };
  if (x.chamou.includes(termo)) return { pontos: 10, motivo: 'quem-chamou' };
  if (x.cooperativa.includes(termo)) return { pontos: 8, motivo: 'cooperativa' };
  if (x.filial.includes(termo)) return { pontos: 5, motivo: 'filial' };
  return null;
}

/**
 * Pontua cada consultor contra o termo. Sem termo, devolve todos com 0 pontos.
 * Número puro (3+ dígitos) procura em celular, telefone e CPF/CNPJ.
 */
export function buscar(indice: Indexado[], termoBruto: string): ResultadoBusca[] {
  const bruto = termoBruto.trim();
  if (!bruto) return indice.map((x) => ({ consultor: x.c, pontos: 0, motivo: null }));

  const digitos = bruto.replace(/\D/g, '');
  if (!/[a-zA-Z]/.test(bruto) && digitos.length >= 3) {
    return indice
      .filter((x) => x.numeros.some((n) => n.includes(digitos)))
      .map((x) => ({
        consultor: x.c,
        pontos: x.numeros.some((n) => n === digitos || n.endsWith(digitos)) ? 100 : 90,
        motivo: null,
      }));
  }

  const termos = palavras(bruto);
  if (!termos.length) return [];
  const literais = literal(bruto)
    .split(/[^a-z0-9@._-]+/)
    .filter((p) => p && !PALAVRAS_VAZIAS.has(p));
  const frase = termos.join(' ');

  const resultados: ResultadoBusca[] = [];
  for (const x of indice) {
    let pontos = 0;
    let motivo: MotivoBusca | null = null;
    let casouTodos = true;
    for (const termo of termos) {
      const campo = pontuarPalavra(x, termo);
      if (!campo) {
        casouTodos = false;
        break;
      }
      pontos += campo.pontos;
      if (campo.motivo && !motivo) motivo = campo.motivo;
    }
    if (!casouTodos) continue;
    // Nome escrito por inteiro, na ordem, sobe acima de quem só tem as palavras soltas.
    if (termos.length > 1 && x.nomePalavras.join(' ').includes(frase)) pontos += 50;
    // "leticya" digitado assim vem antes das "Leticia": a tolerância acha, a grafia exata ordena.
    pontos += literais.filter((l) => x.nomeLiteral.includes(l)).length * 15;
    resultados.push({ consultor: x.c, pontos, motivo });
  }
  return resultados.sort(
    (a, b) => b.pontos - a.pontos || a.consultor.name.localeCompare(b.consultor.name, 'pt-BR'),
  );
}

/**
 * Quem, entre os que casaram pelo NOME, chamou gente para a equipe — vira o atalho
 * "Fulano chamou N consultores · ver equipe".
 */
export function liderancasEncontradas(
  resultados: ResultadoBusca[],
  todos: Consultant[],
): { consultor: Consultant; equipe: number }[] {
  const equipePorNome = new Map<string, number>();
  for (const c of todos) {
    if (c.managerName) {
      const chave = normalizar(c.managerName);
      equipePorNome.set(chave, (equipePorNome.get(chave) ?? 0) + 1);
    }
  }
  return resultados
    .filter((r) => r.motivo === null)
    .map((r) => {
      const chaves = [r.consultor.nickname, r.consultor.name].map(normalizar);
      const equipe = Math.max(0, ...chaves.map((k) => equipePorNome.get(k) ?? 0));
      return { consultor: r.consultor, equipe };
    })
    .filter((l) => l.equipe > 0)
    .slice(0, 3);
}
