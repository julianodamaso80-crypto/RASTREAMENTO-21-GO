import type { PernoiteInfo, UltimaParadaInfo } from '@/types/ble-tag';

/**
 * As frases do histórico da TAG.
 *
 * Vive separado do componente porque o vocabulário aqui é regra de negócio,
 * não decoração: a TAG não tem ignição nem hodômetro, então nada aqui pode
 * dizer "motor desligado" ou "km percorridos". Ela também não reporta
 * sozinha — é vista quando um aparelho passa perto —, então o texto fala de
 * "última vez visto" e de costume observado, nunca de trajeto contínuo.
 *
 * Arquivo puro (sem JSX, sem dependência de runtime) para o teste de
 * linguagem em scripts/diagnostics/tag-historico-honesto.js poder carregá-lo.
 */

export function dataHoraLocal(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function idadeLegivel(desdeIso: string, agora: Date): string {
  const min = Math.round(
    (agora.getTime() - new Date(desdeIso).getTime()) / 60000,
  );
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `${horas}h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? '1 dia' : `${dias} dias`;
}

export function frasePernoite(p: PernoiteInfo): string {
  const onde = p.endereco ?? 'um mesmo local';
  const noites =
    p.diasDistintos === 1 ? 'uma noite' : `${p.diasDistintos} noites`;
  return (
    `Costuma passar a noite em ${onde} — visto lá em ${noites} diferentes` +
    (p.faixaHorariaTexto ? `, entre ${p.faixaHorariaTexto}.` : '.')
  );
}

export function fraseUltimaParada(u: UltimaParadaInfo, agora: Date): string {
  const onde = u.endereco ?? 'um local sem endereço identificado';
  if (u.aindaLa) {
    return `Parado em ${onde} desde ${dataHoraLocal(u.paradoDesde)}.`;
  }
  return (
    `Última vez visto em ${onde}, há ${idadeLegivel(u.ultimoAvistamento, agora)}. ` +
    `Sem novos avistamentos desde então — a TAG só aparece quando alguém passa perto.`
  );
}
