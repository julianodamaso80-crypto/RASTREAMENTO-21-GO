/**
 * O que faz uma TAG estar ATIVA.
 *
 * Regra do dono, 27/08/2026, e ela é dura: só entra na aba o veículo em que
 * conseguimos as duas pontas — sabemos QUEM é o associado (vem do SGA) e
 * sabemos ONDE a TAG está marcando (vem do espelho da plataforma de origem).
 *
 * Faltando qualquer uma das duas, a TAG está *contratada*, não *ativa*. Listar
 * as 9,7 mil contratadas como "ativas" inflava o número e escondia o que
 * importa: quantas dessas o operador consegue de fato achar no mapa.
 *
 * Lógica pura, num arquivo só, porque isto é a definição do produto — não pode
 * ficar diluída num `where` de query onde ninguém acha nem testa.
 */

export type LinhaEspelhoTag = {
  identificador: string;
  modelo: string | null;
  latitude: number | null;
  longitude: number | null;
  seenAt: string | null;
  origem: string;
};

/**
 * A TAG tem posição conhecida?
 *
 * Avistamento antigo continua valendo: a última pista conhecida é exatamente o
 * que serve numa recuperação. Quem mostra a idade é a tela — esconder a TAG
 * por ser velha tiraria do operador a única informação que ele tem.
 */
export function ehTagRastreavel(
  espelho: LinhaEspelhoTag | null | undefined,
): boolean {
  if (!espelho) return false;

  const { latitude, longitude } = espelho;
  if (latitude == null || longitude == null) return false;

  // (0,0) é o "sem posição" da origem. No mapa cairia no golfo da Guiné
  // parecendo posição de verdade.
  if (latitude === 0 && longitude === 0) return false;

  return true;
}
