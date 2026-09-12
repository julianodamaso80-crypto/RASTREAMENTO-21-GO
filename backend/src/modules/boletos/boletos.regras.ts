/** Regra do dono, 12/08/2026: 5 dias de atraso ainda emite; 6 não. */
export const DIAS_PARA_EMITIR = 5;

/** Texto literal do dono (12/09/2026). Não reescrever, não abreviar. */
export const TELEFONE_SETOR_BOLETOS = {
  titulo: 'Para dúvidas e informações, fale com nosso Setor de Boletos:',
  telefones: '📞 (21) 95933-5359 | (21) 98142-2100',
} as const;

const UM_DIA_MS = 86_400_000;

function diaEmBrasilia(d: Date): number {
  const iso = d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return new Date(`${iso}T00:00:00-03:00`).getTime();
}

/** Dias até o vencimento. Negativo = já venceu. */
function diasAte(vencimento: string, hoje: Date): number {
  const venc = new Date(`${vencimento}T00:00:00-03:00`).getTime();
  return Math.round((venc - diaEmBrasilia(hoje)) / UM_DIA_MS);
}

export function rotuloVencimento(vencimento: string | null, hoje: Date): string {
  if (!vencimento) return '';
  const dias = diasAte(vencimento, hoje);
  if (dias === 0) return 'vence hoje';
  if (dias === 1) return 'vence amanhã';
  if (dias > 1) return `vence em ${dias} dias`;
  if (dias === -1) return 'venceu ontem';
  return `venceu há ${Math.abs(dias)} dias`;
}

export function aindaPodePagar(vencimento: string | null, hoje: Date): boolean {
  if (!vencimento) return true;
  const atraso = -diasAte(vencimento, hoje);
  return atraso <= DIAS_PARA_EMITIR;
}

/**
 * A janela em que o SGA aceita a credencial. MEDIDO em 12/09/2026, não presumido:
 * a liberação "00h–23h todo dia" não foi aplicada — sábado ao meio-dia deu 401 em
 * 10.341 tentativas. Vale seg–sex, 7h–18h de Brasília. Se a Hinova liberar de
 * verdade, é esta função que muda, e só ela.
 */
export function dentroDaJanelaDoSga(agora: Date): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  });
  const partes = Object.fromEntries(fmt.formatToParts(agora).map((p) => [p.type, p.value]));
  const diaUtil = !['Sat', 'Sun'].includes(partes.weekday as string);
  const hora = Number(partes.hour);
  return diaUtil && hora >= 7 && hora < 18;
}
