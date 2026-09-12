export type Boleto = {
  id: string;
  placa: string | null;
  mesReferente: string | null;
  valor: number | null;
  vencimento: string | null;
  rotulo: string;
  linhaDigitavel: string | null;
  temPdf: boolean;
};

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * O CRM manda `mesReferente` em dois formatos possíveis, dependendo do
 * caminho ("YYYY-MM" ou "MM/YYYY") — sem o SGA aberto não dá pra provar qual
 * chega em cada um, então aceita os dois (achado I2). Lixo (vazio, nulo, mês
 * fora de 1–12) devolve null em vez de "mês NaN".
 */
function numeroDoMes(mesReferente: string | null): number | null {
  const m = String(mesReferente ?? '');
  let mes: number;
  if (/^\d{4}-\d{2}$/.test(m)) {
    mes = Number(m.slice(5, 7));
  } else if (/^\d{2}\/\d{4}$/.test(m)) {
    mes = Number(m.slice(0, 2));
  } else {
    return null;
  }
  return mes >= 1 && mes <= 12 ? mes : null;
}

export function valorEmReais(valor: number | null): string {
  if (valor == null) return '—';
  const [inteiro, centavos] = valor.toFixed(2).split('.');
  const comPonto = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${comPonto},${centavos}`;
}

/** A cor do cartão sai do rótulo que o backend escreveu — uma regra só, no servidor. */
export function estaVencido(rotulo: string): boolean {
  return rotulo.startsWith('venceu');
}

export function tituloDoBoleto(mesReferente: string | null): string {
  const mesNumero = numeroDoMes(mesReferente);
  const mes = mesNumero ? MESES[mesNumero - 1] : undefined;
  return mes ? `Mensalidade de ${mes}` : 'Mensalidade';
}

/** Mesmo texto de `TELEFONE_SETOR_BOLETOS` no backend (boletos.regras.ts). */
export const RODAPE_SETOR_BOLETOS = {
  titulo: 'Para dúvidas e informações, fale com nosso Setor de Boletos:',
  telefones: '📞 (21) 95933-5359 | (21) 98142-2100',
} as const;

export type EstadoDaLista = 'falha' | 'pendente' | 'foraDoPrazo' | 'emDia';

/**
 * Decide a mensagem quando não há boleto na lista. Achado C3: "sem boleto"
 * tem TRÊS leituras possíveis e confundi-las é grave — dizer "em dia" a quem
 * tem pendência com mais de 5 dias de atraso é informação financeira falsa.
 */
export function estadoDaLista(opts: {
  comFalha: boolean;
  pendente: boolean;
  foraDoPrazo: number;
}): EstadoDaLista {
  if (opts.comFalha) return 'falha';
  if (opts.pendente) return 'pendente';
  if (opts.foraDoPrazo > 0) return 'foraDoPrazo';
  return 'emDia';
}
