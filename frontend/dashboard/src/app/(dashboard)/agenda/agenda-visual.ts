import type {
  AppointmentEvent,
  AppointmentStatus,
  ExecutionTiming,
  ServiceType,
} from '@/types/appointment';

/**
 * A gramática visual do calendário, copiada da plataforma de origem: a COR diz
 * o tipo de serviço e o ÍCONE diz o status. São duas informações diferentes e
 * por isso ocupam canais diferentes — juntá-las num só perde uma das duas.
 */

export const COR_SERVICO: Record<ServiceType, string> = {
  INSTALLATION: '#16a34a',
  MAINTENANCE: '#ea8c00',
  REMOVAL: '#dc2626',
  OTHER: '#6b7280',
};

/** Ícone do desfecho. Serve para ler a grade sem abrir bloco nenhum. */
export function iconeStatus(status: AppointmentStatus): string {
  switch (status) {
    case 'COMPLETED':
    case 'EXECUTED':
      return '✔️';
    case 'SCHEDULED':
      return '🕐';
    case 'CANCELED':
    case 'CANCELED_BY_CLIENT':
    case 'CLOSED_BY_SYSTEM':
      return '❌';
    case 'FRUSTRATED_CLIENT':
    case 'FRUSTRATED_TECHNICIAN':
    case 'CLIENT_NO_SHOW':
      return '🚫';
    case 'POSTPONED':
    case 'ANTICIPATED':
      return '📅';
    default:
      return '📅';
  }
}

/** Ícone de quando a execução saiu do horário combinado. */
export function iconeTiming(timing: ExecutionTiming): string {
  switch (timing) {
    case 'TECHNICIAN_LATE':
      return '⏰';
    case 'TECHNICIAN_EARLY':
      return '🚀';
    case 'ANTICIPATED_BY_TECHNICIAN':
      return '🔀';
    default:
      return '';
  }
}

/** Prefixo do bloco: os avisos primeiro, depois o desfecho. */
export function prefixoDoEvento(e: AppointmentEvent): string {
  const partes = [
    iconeTiming(e.executionTiming),
    e.hasTechnicianReply ? '💬' : '',
    e.autoScheduled ? '💡' : '',
    e.locationDenied ? '📍' : '',
    iconeStatus(e.status),
  ];
  return partes.filter(Boolean).join(' ');
}

/** Cancelado sai desbotado — continua legível, para de disputar atenção. */
export function opacidadeDoEvento(status: AppointmentStatus): number {
  const mortos: AppointmentStatus[] = [
    'CANCELED',
    'CANCELED_BY_CLIENT',
    'CLOSED_BY_SYSTEM',
  ];
  return mortos.includes(status) ? 0.55 : 1;
}

export const LEGENDA_SERVICO: { cor: string; texto: string }[] = [
  { cor: COR_SERVICO.INSTALLATION, texto: 'Instalação' },
  { cor: COR_SERVICO.MAINTENANCE, texto: 'Manutenção' },
  { cor: COR_SERVICO.REMOVAL, texto: 'Retirada' },
  { cor: COR_SERVICO.OTHER, texto: 'Demais serviços' },
];

export const LEGENDA_ICONE: { icone: string; texto: string }[] = [
  { icone: '🕐', texto: 'Agendado' },
  { icone: '✔️', texto: 'Concluído' },
  { icone: '❌', texto: 'Cancelado' },
  { icone: '🚫', texto: 'Visita frustrada' },
  { icone: '📅', texto: 'Prorrogado / adiantado' },
  { icone: '⏰', texto: 'Técnico com atraso' },
  { icone: '🚀', texto: 'Técnico adiantado' },
  { icone: '🔀', texto: 'Antecipado pelo técnico' },
  { icone: '💬', texto: 'Contém resposta do técnico' },
  { icone: '💡', texto: 'Auto-agendamento' },
  { icone: '📍', texto: 'Concluído sem localização válida' },
];
