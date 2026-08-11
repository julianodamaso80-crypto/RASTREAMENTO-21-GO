/**
 * Estado de comunicação de um ativo, a partir dos DOIS carimbos que nunca podem
 * ser confundidos:
 *
 * - `lastConnection` (GPRS): o chip respirou. Prova que o aparelho tem energia e
 *   sinal de celular. NÃO prova onde o veículo está.
 * - `lastFixTime` (GPS): o único carimbo que prova "o veículo estava AQUI neste
 *   instante".
 *
 * O caso que essa distinção existe pra pegar: GPRS vivo e GPS congelado. É a
 * assinatura de jammer ligado ou antena arrancada — um roubo em andamento. Numa
 * tela que mostrasse só "última atualização", esse ativo pareceria saudável.
 */

export type CommsState =
  /** Comunicando e com posição recente. */
  | 'OK'
  /** O chip fala, o GPS parou. Suspeita de jammer ou antena arrancada. */
  | 'GPS_CONGELADO'
  /** Nada há mais de um dia. */
  | 'MUDO'
  /** Nunca comunicou desde a instalação. */
  | 'NUNCA';

export interface CommsAssessment {
  state: CommsState;
  /** Idade do último GPRS em minutos (null = nunca comunicou). */
  gprsAgeMinutes: number | null;
  /** Idade do último fix de GPS em minutos (null = nunca teve posição). */
  gpsAgeMinutes: number | null;
}

const MINUTE_MS = 60 * 1000;

/** Sem nada há 24h o ativo é tratado como mudo, não como "GPS congelado". */
const MUDO_MINUTOS = 24 * 60;
/** Seis horas sem fix, com o chip vivo, já é anormal pro parque GT06/J16. */
const GPS_CONGELADO_MINUTOS = 6 * 60;

export function assessComms(
  lastConnection: Date | null,
  lastFixTime: Date | null,
  now: Date = new Date(),
): CommsAssessment {
  const gprsAgeMinutes = ageInMinutes(lastConnection, now);
  const gpsAgeMinutes = ageInMinutes(lastFixTime, now);

  if (gprsAgeMinutes === null && gpsAgeMinutes === null) {
    return { state: 'NUNCA', gprsAgeMinutes, gpsAgeMinutes };
  }

  // O sinal de vida mais recente, venha de onde vier: um device que só tem
  // posição (sem lastConnection gravado) não pode ser chamado de mudo.
  const ultimoSinal = Math.min(
    gprsAgeMinutes ?? Number.POSITIVE_INFINITY,
    gpsAgeMinutes ?? Number.POSITIVE_INFINITY,
  );

  if (ultimoSinal >= MUDO_MINUTOS) {
    return { state: 'MUDO', gprsAgeMinutes, gpsAgeMinutes };
  }

  if (gpsAgeMinutes === null || gpsAgeMinutes >= GPS_CONGELADO_MINUTOS) {
    return { state: 'GPS_CONGELADO', gprsAgeMinutes, gpsAgeMinutes };
  }

  return { state: 'OK', gprsAgeMinutes, gpsAgeMinutes };
}

function ageInMinutes(when: Date | null, now: Date): number | null {
  if (!when) return null;
  return Math.max(0, Math.floor((now.getTime() - when.getTime()) / MINUTE_MS));
}
