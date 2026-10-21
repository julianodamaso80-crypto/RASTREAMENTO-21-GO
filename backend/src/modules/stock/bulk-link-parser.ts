/**
 * Leitura da planilha/PDF do "Vincular em massa": transforma uma tabela de
 * células em linhas {placa, imei, técnico, local}, já com o motivo de cada linha
 * que não dá para vincular. Sem acesso a banco nem ao SGA — só texto.
 */

export interface LinhaVinculo {
  /** Número da linha no arquivo (planilha) ou da linha de texto (PDF). */
  linha: number;
  placa: string;
  imei: string;
  tecnico: string;
  local: string;
  /** Preenchido quando a linha já nasce inválida; essas não vão ao SGA. */
  erro?: string;
}

export interface TabelaLida {
  linhas: LinhaVinculo[];
  erroGeral?: string;
}

type Campo = 'placa' | 'imei' | 'tecnico' | 'local';

function normalizar(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function campoDoCabecalho(celula: string): Campo | null {
  const h = normalizar(celula);
  if (!h) return null;
  if (h.includes('IMEI')) return 'imei';
  if (h.includes('PLACA')) return 'placa';
  if (h.includes('TECNIC') || h.includes('INSTALADOR')) return 'tecnico';
  if (h.includes('LOCAL')) return 'local';
  return null;
}

const NOMES: Record<Campo, string> = {
  placa: 'placa',
  imei: 'IMEI',
  tecnico: 'técnico',
  local: 'local de instalação',
};

export const MSG_CABECALHO =
  'Não encontrei o cabeçalho. A primeira linha da tabela precisa ter as colunas ' +
  'PLACA, IMEI, TÉCNICO e LOCAL (em qualquer ordem).';

/**
 * IMEI de rastreador tem 15 dígitos; a TAG não tem IMEI e vem com um ID de 10 ou
 * 11 dígitos (ex.: 92603018558). Qualquer outro tamanho é erro de digitação.
 */
export function tamanhoDeImeiOuTag(digitos: string): boolean {
  return [10, 11, 15].includes(digitos.length);
}

export function linhasDaTabela(matriz: string[][]): TabelaLida {
  let cabecalho = -1;
  const coluna = new Map<Campo, number>();

  // Procura o cabeçalho nas primeiras linhas: PDF costuma trazer um título antes.
  for (let i = 0; i < Math.min(matriz.length, 20); i++) {
    const achados = new Map<Campo, number>();
    matriz[i].forEach((cel, c) => {
      const campo = campoDoCabecalho(cel ?? '');
      if (campo && !achados.has(campo)) achados.set(campo, c);
    });
    if (achados.has('imei') && achados.has('placa')) {
      cabecalho = i;
      achados.forEach((c, campo) => coluna.set(campo, c));
      break;
    }
  }

  if (cabecalho < 0) return { linhas: [], erroGeral: MSG_CABECALHO };

  const faltando = (['tecnico', 'local'] as Campo[]).filter(
    (c) => !coluna.has(c),
  );
  if (faltando.length) {
    return {
      linhas: [],
      erroGeral:
        `Não encontrei a coluna de ${faltando.map((c) => NOMES[c]).join(' e ')}. ` +
        'Sem técnico e local de instalação o vínculo não é ativado.',
    };
  }

  const linhas: LinhaVinculo[] = [];
  const imeiVisto = new Map<string, number>();

  for (let i = cabecalho + 1; i < matriz.length; i++) {
    const cel = (campo: Campo) =>
      (matriz[i][coluna.get(campo) as number] ?? '').toString().trim();
    const bruto = {
      placa: cel('placa'),
      imei: cel('imei'),
      tecnico: cel('tecnico'),
      local: cel('local'),
    };
    if (!bruto.placa && !bruto.imei && !bruto.tecnico && !bruto.local) continue;
    // PDF repete o cabeçalho a cada página.
    if (
      campoDoCabecalho(bruto.imei) === 'imei' &&
      campoDoCabecalho(bruto.placa) === 'placa'
    ) {
      continue;
    }

    const placa = bruto.placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const imei = bruto.imei.replace(/\D/g, '');
    const problemas: string[] = [];

    const faltou = (
      [
        ['placa', placa],
        ['imei', bruto.imei],
        ['tecnico', bruto.tecnico],
        ['local', bruto.local],
      ] as Array<[Campo, string]>
    )
      .filter(([, v]) => !v)
      .map(([c]) => NOMES[c]);
    if (faltou.length) problemas.push(`Faltou: ${faltou.join(', ')}`);

    if (placa && placa.length !== 7 && placa.length !== 17) {
      problemas.push(
        `Placa inválida "${bruto.placa}" (use 7 caracteres, ou os 17 do chassi)`,
      );
    }
    if (bruto.imei) {
      if (/E\+?\d+/i.test(bruto.imei) && /[.,]/.test(bruto.imei)) {
        problemas.push(
          `IMEI "${bruto.imei}" veio em notação científica (o Excel cortou os dígitos); formate a coluna como texto`,
        );
      } else if (!tamanhoDeImeiOuTag(imei)) {
        problemas.push(
          `IMEI inválido "${bruto.imei}" (precisa de 15 dígitos; TAG usa o ID de 10 ou 11 dígitos)`,
        );
      }
    }

    const numero = i + 1;
    if (!problemas.length) {
      const antes = imeiVisto.get(imei);
      if (antes !== undefined) {
        problemas.push(`IMEI repetido no arquivo (já está na linha ${antes})`);
      } else {
        imeiVisto.set(imei, numero);
      }
    }

    linhas.push({
      linha: numero,
      placa,
      imei,
      tecnico: bruto.tecnico,
      local: bruto.local,
      ...(problemas.length ? { erro: problemas.join('; ') } : {}),
    });
  }

  return { linhas };
}

export interface ItemTexto {
  str: string;
  x: number;
  y: number;
  width: number;
}

/**
 * Itens de texto do PDF (com posição) -> linhas de células. Mesma altura = mesma
 * linha; um vão maior que `VAO_CELULA` entre dois itens começa outra célula.
 */
const VAO_CELULA = 6;
const TOLERANCIA_Y = 3;

export function agruparItensEmLinhas(itens: ItemTexto[]): string[][] {
  const uteis = itens.filter((i) => i.str.trim() !== '');
  const faixas: Array<{ y: number; itens: ItemTexto[] }> = [];
  for (const item of uteis) {
    const faixa = faixas.find((f) => Math.abs(f.y - item.y) <= TOLERANCIA_Y);
    if (faixa) faixa.itens.push(item);
    else faixas.push({ y: item.y, itens: [item] });
  }
  // No PDF o y cresce para cima: maior y = mais alto na página.
  faixas.sort((a, b) => b.y - a.y);

  return faixas.map((faixa) => {
    const ordenados = [...faixa.itens].sort((a, b) => a.x - b.x);
    const celulas: string[] = [];
    let fim = Number.NEGATIVE_INFINITY;
    for (const item of ordenados) {
      const texto = item.str.trim();
      if (celulas.length && item.x - fim <= VAO_CELULA) {
        celulas[celulas.length - 1] += ` ${texto}`;
      } else {
        celulas.push(texto);
      }
      fim = item.x + item.width;
    }
    return celulas;
  });
}
