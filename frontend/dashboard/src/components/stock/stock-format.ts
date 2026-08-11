import type { StockConexao, StockMapPoint } from '@/types/stock';

/** "há 3 s", "há 4 dias" — a idade do dado sempre visível. */
export function haQuantoTempo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
  const meses = Math.round(d / 30);
  if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  const anos = Math.round(meses / 12);
  return `há ${anos} ${anos === 1 ? 'ano' : 'anos'}`;
}

export function badgeConexao(conexao: StockConexao): {
  rotulo: string;
  fundo: string;
  texto: string;
  borda: string;
  ponto: string;
} {
  switch (conexao) {
    case 'ONLINE':
      return {
        rotulo: 'ONLINE',
        fundo: 'bg-emerald-500/15',
        texto: 'text-emerald-400',
        borda: 'border-emerald-500',
        ponto: 'bg-emerald-400',
      };
    case 'SLEEP':
      return {
        rotulo: 'SLEEP',
        fundo: 'bg-sky-500/15',
        texto: 'text-sky-400',
        borda: 'border-sky-500',
        ponto: 'bg-sky-400',
      };
    case 'NUNCA':
      return {
        rotulo: 'SEM SINAL',
        fundo: 'bg-slate-500/15',
        texto: 'text-slate-400',
        borda: 'border-slate-500',
        ponto: 'bg-slate-400',
      };
    default:
      return {
        rotulo: 'OFFLINE',
        fundo: 'bg-red-500/15',
        texto: 'text-red-400',
        borda: 'border-red-500',
        ponto: 'bg-red-400',
      };
  }
}

/**
 * Voltagem no formato da referência: `12.63v`, e `0.00v` quando o equipamento
 * não manda leitura (é o valor cru que ele reporta).
 */
export function textoVoltagem(volts: number | null): string {
  return `${(volts ?? 0).toFixed(2)}v`;
}

export function textoIgnicao(ignicao: boolean | null): string {
  if (ignicao === null) return '--';
  return ignicao ? 'Ligada' : 'Desligada';
}
