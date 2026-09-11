import {
  AppointmentShift,
  AppointmentStatus,
  ExecutionTiming,
  ServiceType,
} from '.prisma/client';

/// Janelas fixas de cada turno, em horas locais. Iguais às da origem: o turno
/// só existe para poupar digitação — quem manda no calendário é o par
/// (scheduledStart, scheduledEnd).
const JANELAS: Record<string, [number, number]> = {
  MORNING: [8, 12],
  AFTERNOON: [13, 18],
  NIGHT: [18, 22],
  ALL_DAY: [8, 18],
};

export interface Periodo {
  inicio: Date;
  fim: Date;
}

/// Monta o período a partir do dia + turno. CUSTOM exige as duas horas.
export function periodoDoTurno(
  dia: string,
  turno: AppointmentShift,
  horaInicio?: string | null,
  horaFim?: string | null,
): Periodo {
  const [ano, mes, d] = dia.split('-').map(Number);
  if (!ano || !mes || !d) {
    throw new Error('Data do agendamento inválida.');
  }

  if (turno === 'CUSTOM') {
    if (!horaInicio || !horaFim) {
      throw new Error('Turno customizável exige hora de início e de fim.');
    }
    const inicio = comHora(ano, mes, d, horaInicio);
    const fim = comHora(ano, mes, d, horaFim);
    if (fim <= inicio) {
      throw new Error('A hora de fim não pode ser anterior à de início.');
    }
    return { inicio, fim };
  }

  const janela = JANELAS[turno];
  if (!janela) {
    throw new Error('Turno inválido.');
  }
  return {
    inicio: new Date(ano, mes - 1, d, janela[0], 0, 0, 0),
    fim: new Date(ano, mes - 1, d, janela[1], 0, 0, 0),
  };
}

function comHora(ano: number, mes: number, dia: number, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error('Horário inválido.');
  }
  return new Date(ano, mes - 1, dia, h, m, 0, 0);
}

/// Caminho inverso: dado o período gravado, diz que turno ele representa. É o
/// que faz a tela reabrir o agendamento com o botão certo já marcado.
export function turnoDoPeriodo(inicio: Date, fim: Date): AppointmentShift {
  const chave = `${inicio.getHours()}:${fim.getHours()}`;
  for (const [turno, [h1, h2]] of Object.entries(JANELAS)) {
    if (chave === `${h1}:${h2}` && inicio.getMinutes() === 0 && fim.getMinutes() === 0) {
      return turno as AppointmentShift;
    }
  }
  return 'CUSTOM';
}

/// Número da OS no formato da origem: AAAAMMDD/sequencial do tenant.
export function numeroOs(criadoEm: Date, sequencial: number): string {
  const ano = criadoEm.getFullYear();
  const mes = String(criadoEm.getMonth() + 1).padStart(2, '0');
  const dia = String(criadoEm.getDate()).padStart(2, '0');
  return `${ano}${mes}${dia}/${sequencial}`;
}

/// Manutenção sem motivo não entra — a origem obriga, e é o motivo que separa
/// falha de instalação de falha de sinal na hora de cobrar o técnico.
export function exigeMotivoManutencao(tipo: ServiceType): boolean {
  return tipo === 'MAINTENANCE';
}

/// Os desfechos que a origem recusa em branco. Cancelar ou dar visita frustrada
/// sem escrever o porquê é justamente o que apaga o rastro da tratativa.
const EXIGEM_OBSERVACAO: AppointmentStatus[] = [
  'CANCELED',
  'CANCELED_BY_CLIENT',
  'FRUSTRATED_CLIENT',
  'FRUSTRATED_TECHNICIAN',
];

export function exigeObservacao(status: AppointmentStatus): boolean {
  return EXIGEM_OBSERVACAO.includes(status);
}

/// Desfechos que alguém declara ESTANDO no local: é neles, e só neles, que a
/// ausência de coordenada quer dizer alguma coisa. Cancelamento feito no
/// escritório não tem por que carregar GPS, e marcá-lo como "sem localização
/// válida" encheria a grade de aviso falso.
const DESFECHOS_DE_CAMPO: AppointmentStatus[] = [
  'COMPLETED',
  'EXECUTED',
  'FRUSTRATED_CLIENT',
  'FRUSTRATED_TECHNICIAN',
  'CLIENT_NO_SHOW',
];

export function exigeLocalizacao(status: AppointmentStatus): boolean {
  return DESFECHOS_DE_CAMPO.includes(status);
}

/// Tolerância de atraso, em minutos, antes de a OS ser marcada com ⏰.
export const TOLERANCIA_ATRASO_MIN = 30;

/// Compara quando o técnico executou com o que estava combinado. Só descreve o
/// que aconteceu; não julga nem bloqueia.
export function timingDaExecucao(
  agendadoInicio: Date,
  agendadoFim: Date,
  executadoEm: Date,
): ExecutionTiming {
  const atrasoMin = (executadoEm.getTime() - agendadoFim.getTime()) / 60000;
  if (atrasoMin > TOLERANCIA_ATRASO_MIN) return 'TECHNICIAN_LATE';

  const adiantoMin = (agendadoInicio.getTime() - executadoEm.getTime()) / 60000;
  if (adiantoMin > TOLERANCIA_ATRASO_MIN) {
    // Executou antes da janela e num dia anterior = antecipou o serviço.
    const outroDia = executadoEm.toDateString() !== agendadoInicio.toDateString();
    return outroDia ? 'ANTICIPATED_BY_TECHNICIAN' : 'TECHNICIAN_EARLY';
  }
  return 'ON_TIME';
}

/// Status em que a OS ainda está "viva": a origem só deixa excluir e duplicar
/// nesses três (agendado, prorrogado, adiantado). OS que já teve desfecho é
/// histórico da tratativa e fica.
const STATUS_EM_ABERTO: AppointmentStatus[] = [
  'SCHEDULED',
  'POSTPONED',
  'ANTICIPATED',
];

export function emAberto(status: AppointmentStatus): boolean {
  return STATUS_EM_ABERTO.includes(status);
}

export const MENSAGEM_EXCLUSAO_BLOQUEADA =
  'A exclusão só é permitida para agendamentos com os status agendado, prorrogado ou adiantado.';

/// Quando a lista filtra pela data de CONCLUSÃO, a origem desabilita os status
/// que não têm conclusão (agendado, cancelado, prorrogado, adiantado e as
/// visitas frustradas). Sobram estes.
export const STATUS_COM_CONCLUSAO: AppointmentStatus[] = [
  'COMPLETED',
  'CLOSED_BY_SYSTEM',
  'EXECUTED',
  'CLIENT_NO_SHOW',
  'CANCELED_BY_CLIENT',
];

/// Teto de período da origem, tanto na lista de OS quanto nos gráficos.
export const PERIODO_MAXIMO_DIAS = 90;

/// Quantos dias o período cobre, contando os dois extremos (07 a 07 = 1 dia),
/// como a origem escreve no título dos gráficos. Recusa período invertido ou
/// acima do teto.
export function diasDoPeriodo(inicio: Date, fim: Date): number {
  if (fim < inicio) {
    throw new Error('A data de início não pode ser posterior à data fim.');
  }
  const umDia = 24 * 60 * 60 * 1000;
  const dias =
    Math.round(
      (new Date(fim.getFullYear(), fim.getMonth(), fim.getDate()).getTime() -
        new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate()).getTime()) /
        umDia,
    ) + 1;
  if (dias > PERIODO_MAXIMO_DIAS) {
    throw new Error(`Selecione um período inferior a ${PERIODO_MAXIMO_DIAS} dias.`);
  }
  return dias;
}

/// As três janelas dos cards "Quantidade de agendados" da aba Análise:
/// o que falta do dia de hoje, os próximos 7 dias e do 8º ao 30º dia.
export function janelasDosCards(agora: Date): Record<'hoje' | 'semana' | 'mes', Periodo> {
  const dia = (n: number, fimDoDia = false) =>
    new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate() + n,
      fimDoDia ? 23 : 0,
      fimDoDia ? 59 : 0,
      fimDoDia ? 59 : 0,
      fimDoDia ? 999 : 0,
    );
  return {
    hoje: { inicio: agora, fim: dia(0, true) },
    semana: { inicio: dia(1), fim: dia(7, true) },
    mes: { inicio: dia(8), fim: dia(30, true) },
  };
}
