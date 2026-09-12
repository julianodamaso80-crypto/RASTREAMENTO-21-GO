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
  const mes = MESES[Number(String(mesReferente ?? '').slice(0, 2)) - 1];
  return mes ? `Mensalidade de ${mes}` : 'Mensalidade';
}
