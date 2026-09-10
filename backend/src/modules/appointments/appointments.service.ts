import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { filtroBusca } from '../../common/search/termo-busca';
import {
  exigeLocalizacao,
  exigeMotivoManutencao,
  exigeObservacao,
  numeroOs,
  periodoDoTurno,
  timingDaExecucao,
  turnoDoPeriodo,
} from './appointments.regras';
import type {
  CriarAgendamento,
  EditarAgendamento,
  FiltroAgenda,
  MudarStatus,
  PreenchimentoVeiculo,
} from './appointments.types';

/**
 * Agenda de ordens de serviço dos técnicos.
 *
 * Espelha o módulo `/agendamentos/` da plataforma de origem (medido em
 * 10/09/2026): mesmos tipos de serviço, mesmos status, mesmo par
 * status-da-OS x status-do-técnico, mesmo formato de número de OS.
 *
 * A diferença que importa está em `preencherPorPlaca` e em `pendencias`: lá a
 * fila de serviços a agendar é digitada à mão; aqui ela já existe, espelhada do
 * SGA em `installation_pendings`.
 */
@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  /// Eventos do calendário no período. É a consulta que a tela faz a cada
  /// troca de mês, então filtra no banco e devolve só o que o bloco mostra.
  async agenda(tenantId: string, filtro: FiltroAgenda) {
    const where: Prisma.AppointmentWhereInput = {
      tenantId,
      deletedAt: null,
      scheduledStart: { gte: filtro.from, lte: filtro.to },
    };

    if (filtro.technicianIds?.length) {
      where.technicianId = { in: filtro.technicianIds };
    }
    if (filtro.status?.length) {
      where.status = { in: filtro.status };
    }
    if (filtro.serviceType) {
      where.serviceType = filtro.serviceType;
    }

    const busca = filtroBusca(filtro.search, {
      texto: ['clientName', 'address'],
      alfanumerico: ['plate', 'chassi', 'osNumber'],
      documento: ['cpfCnpj'],
      identificador: ['imei', 'phone'],
    });
    if (busca) {
      where.AND = [busca];
    }

    const linhas = await this.prisma.appointment.findMany({
      where,
      orderBy: { scheduledStart: 'asc' },
      include: { technician: { select: { id: true, name: true } } },
    });

    return linhas.map((a) => this.paraEvento(a));
  }

  async porId(tenantId: string, id: string) {
    const a = await this.prisma.appointment.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { technician: { select: { id: true, name: true, cpf: true } } },
    });
    if (!a) throw new NotFoundException('Agendamento não encontrado.');
    return {
      ...a,
      shift: turnoDoPeriodo(a.scheduledStart, a.scheduledEnd),
      value: Number(a.value),
    };
  }

  async criar(tenantId: string, dados: CriarAgendamento, userId?: string) {
    this.validarServico(dados.serviceType, dados.maintenanceReason);

    const tecnico = await this.prisma.technician.findFirst({
      where: { id: dados.technicianId, tenantId, deletedAt: null },
      select: { id: true, active: true },
    });
    if (!tecnico) throw new NotFoundException('Técnico não encontrado.');
    if (!tecnico.active) {
      throw new BadRequestException('Técnico inativo não recebe agendamento.');
    }

    const periodo = this.periodo(dados);
    const agora = new Date();

    return this.prisma.appointment.create({
      data: {
        osNumber: await this.proximoNumeroOs(tenantId, agora),
        serviceType: dados.serviceType,
        maintenanceReason: dados.maintenanceReason ?? null,
        conduction: dados.conduction ?? 'MOBILE',
        scheduledStart: periodo.inicio,
        scheduledEnd: periodo.fim,
        shift: dados.shift,
        technicianId: dados.technicianId,
        vehicleId: dados.vehicleId ?? null,
        plate: dados.plate ?? null,
        chassi: dados.chassi ?? null,
        imei: dados.imei ?? null,
        brand: dados.brand ?? null,
        model: dados.model ?? null,
        installLocation: dados.installLocation ?? null,
        clientName: dados.clientName ?? null,
        cpfCnpj: dados.cpfCnpj ?? null,
        phone: dados.phone ?? null,
        email: dados.email ?? null,
        cep: dados.cep ?? null,
        address: dados.address ?? null,
        complement: dados.complement ?? null,
        lat: dados.lat ?? null,
        lng: dados.lng ?? null,
        value: dados.value ?? 0,
        description: dados.description ?? null,
        technicianNote: dados.technicianNote ?? null,
        installationPendingId: dados.installationPendingId ?? null,
        createdById: userId ?? null,
        tenantId,
      },
    });
  }

  async editar(tenantId: string, id: string, dados: EditarAgendamento) {
    const atual = await this.prisma.appointment.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!atual) throw new NotFoundException('Agendamento não encontrado.');

    const tipo = dados.serviceType ?? atual.serviceType;
    const motivo =
      dados.maintenanceReason !== undefined
        ? dados.maintenanceReason
        : atual.maintenanceReason;
    this.validarServico(tipo, motivo);

    const data: Prisma.AppointmentUpdateInput = {};

    // Remarcar exige o dia e o turno juntos: turno sozinho não diz o dia, e
    // dia sozinho não diz a janela.
    if (dados.date || dados.shift) {
      const periodo = this.periodo({
        date: dados.date ?? isoDia(atual.scheduledStart),
        shift:
          dados.shift ?? turnoDoPeriodo(atual.scheduledStart, atual.scheduledEnd),
        startTime: dados.startTime,
        endTime: dados.endTime,
      });
      data.scheduledStart = periodo.inicio;
      data.scheduledEnd = periodo.fim;
      data.shift = dados.shift ?? turnoDoPeriodo(periodo.inicio, periodo.fim);
    }

    const copiaveis = [
      'plate',
      'chassi',
      'imei',
      'brand',
      'model',
      'installLocation',
      'clientName',
      'cpfCnpj',
      'phone',
      'email',
      'cep',
      'address',
      'complement',
      'lat',
      'lng',
      'description',
      'technicianNote',
      'conduction',
    ] as const;
    for (const campo of copiaveis) {
      if (dados[campo] !== undefined) {
        (data as Record<string, unknown>)[campo] = dados[campo];
      }
    }
    if (dados.serviceType !== undefined) data.serviceType = dados.serviceType;
    if (dados.maintenanceReason !== undefined) {
      data.maintenanceReason = dados.maintenanceReason;
    }
    if (dados.value !== undefined && dados.value !== null) {
      data.value = dados.value;
    }
    if (dados.technicianId) {
      const tecnico = await this.prisma.technician.findFirst({
        where: { id: dados.technicianId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!tecnico) throw new NotFoundException('Técnico não encontrado.');
      data.technician = { connect: { id: dados.technicianId } };
    }
    if (dados.vehicleId !== undefined) {
      data.vehicle = dados.vehicleId
        ? { connect: { id: dados.vehicleId } }
        : { disconnect: true };
    }

    return this.prisma.appointment.update({ where: { id }, data });
  }

  /// Remarcar arrastando o bloco no calendário. Só mexe em data: quem arrasta
  /// não está mudando serviço nem cliente.
  async remarcar(tenantId: string, id: string, inicio: Date, fim: Date) {
    const atual = await this.prisma.appointment.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!atual) throw new NotFoundException('Agendamento não encontrado.');
    if (fim <= inicio) {
      throw new BadRequestException(
        'A hora de fim não pode ser anterior à de início.',
      );
    }
    return this.prisma.appointment.update({
      where: { id },
      data: {
        scheduledStart: inicio,
        scheduledEnd: fim,
        shift: turnoDoPeriodo(inicio, fim),
      },
    });
  }

  async mudarStatus(tenantId: string, id: string, dados: MudarStatus) {
    const atual = await this.prisma.appointment.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!atual) throw new NotFoundException('Agendamento não encontrado.');

    if (exigeObservacao(dados.status) && !dados.note?.trim()) {
      throw new BadRequestException(
        'Cancelamento e visita frustrada exigem observação.',
      );
    }

    const agora = new Date();
    const concluiu = dados.status === 'COMPLETED' || dados.status === 'EXECUTED';

    return this.prisma.appointment.update({
      where: { id },
      data: {
        status: dados.status,
        technicianStatus: dados.technicianStatus ?? atual.technicianStatus,
        statusNote: dados.note?.trim() || null,
        statusChangedAt: agora,
        completedAt: concluiu ? agora : atual.completedAt,
        completedLat: dados.lat ?? atual.completedLat,
        completedLng: dados.lng ?? atual.completedLng,
        // Sem coordenada num desfecho DE CAMPO a OS fica marcada: é o que
        // separa quem esteve no local de quem só apertou o botão. Cancelamento
        // feito no escritório não entra nessa conta.
        locationDenied: exigeLocalizacao(dados.status)
          ? dados.lat == null || dados.lng == null
          : atual.locationDenied,
        executionTiming: concluiu
          ? timingDaExecucao(atual.scheduledStart, atual.scheduledEnd, agora)
          : atual.executionTiming,
      },
    });
  }

  /// Soft delete, como todo o resto do sistema.
  async remover(tenantId: string, id: string) {
    const atual = await this.prisma.appointment.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!atual) throw new NotFoundException('Agendamento não encontrado.');
    await this.prisma.appointment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * A lista arrastável ao lado do calendário.
   *
   * Na origem essa fila é digitada. Aqui ela é o espelho do SGA: quem tem
   * rastreador pendente já está em `installation_pendings`, atualizado pelo
   * cron. Some da lista quem já tem OS aberta.
   */
  async pendencias(tenantId: string, limite = 50, busca?: string) {
    const jaAgendadas = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        installationPendingId: { not: null },
        status: { notIn: ['CANCELED', 'CANCELED_BY_CLIENT'] },
      },
      select: { installationPendingId: true },
    });
    const usados = jaAgendadas
      .map((a) => a.installationPendingId)
      .filter((v): v is string => Boolean(v));

    const where: Prisma.InstallationPendingWhereInput = {
      tenantId,
      pendingType: 'TRACKER',
      ...(usados.length ? { id: { notIn: usados } } : {}),
    };
    const filtro = filtroBusca(busca, {
      texto: ['associateName', 'city', 'neighborhood'],
      alfanumerico: ['plate', 'chassi'],
      documento: ['cpf'],
      identificador: ['phone'],
    });
    if (filtro) where.AND = [filtro];

    const linhas = await this.prisma.installationPending.findMany({
      where,
      orderBy: { contractDate: 'asc' },
      take: limite,
    });

    return linhas.map((p) => ({
      id: p.id,
      plate: p.plate || p.chassi || '',
      chassi: p.chassi,
      clientName: p.associateName,
      cpfCnpj: p.cpf,
      phone: p.phone,
      email: p.email,
      brandModel: p.brandModel,
      city: p.city,
      neighborhood: p.neighborhood,
      cep: p.cep,
      address: [p.street, p.number].filter(Boolean).join(', ') || null,
      lat: p.lat,
      lng: p.lng,
      contractDate: p.contractDate,
      serviceType: 'INSTALLATION' as const,
    }));
  }

  /**
   * Preenche o formulário a partir da placa ou do chassi.
   *
   * Procura em três lugares, nesta ordem: ativo nosso, pendência de instalação
   * e espelho cadastral do SGA. A origem só tem o primeiro, e é por isso que lá
   * o operador redigita o cliente que ainda não virou ativo.
   */
  async preencherPorPlaca(
    tenantId: string,
    termo: string,
  ): Promise<PreenchimentoVeiculo | null> {
    const t = termo.trim().toUpperCase();
    if (t.length < 4) return null;

    const veiculo = await this.prisma.vehicle.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ plate: t }, { chassi: t }],
      },
      include: {
        associate: {
          select: { name: true, cpf: true, phone: true, email: true },
        },
        device: { select: { imei: true, installLocation: true } },
      },
    });
    if (veiculo) {
      return {
        origem: 'ATIVO',
        vehicleId: veiculo.id,
        plate: veiculo.plate,
        chassi: veiculo.chassi ?? undefined,
        imei: veiculo.device?.imei ?? undefined,
        brand: veiculo.brand ?? undefined,
        model: veiculo.model ?? undefined,
        installLocation: veiculo.device?.installLocation ?? undefined,
        clientName: veiculo.associate?.name ?? undefined,
        cpfCnpj: veiculo.associate?.cpf ?? undefined,
        phone: veiculo.associate?.phone ?? undefined,
        email: veiculo.associate?.email ?? undefined,
        sgaSituation: veiculo.sgaStatusLabel ?? undefined,
      };
    }

    const pendencia = await this.prisma.installationPending.findFirst({
      where: { tenantId, OR: [{ plate: t }, { chassi: t }] },
    });
    if (pendencia) {
      return {
        origem: 'PENDENCIA_SGA',
        installationPendingId: pendencia.id,
        plate: pendencia.plate || undefined,
        chassi: pendencia.chassi ?? undefined,
        brand: pendencia.brandModel,
        clientName: pendencia.associateName,
        cpfCnpj: pendencia.cpf ?? undefined,
        phone: pendencia.phone ?? undefined,
        email: pendencia.email ?? undefined,
        cep: pendencia.cep ?? undefined,
        address:
          [
            pendencia.street,
            pendencia.number,
            pendencia.neighborhood,
            pendencia.city,
          ]
            .filter(Boolean)
            .join(', ') || undefined,
        lat: pendencia.lat ?? undefined,
        lng: pendencia.lng ?? undefined,
      };
    }

    const sga = await this.prisma.sgaVehicle.findFirst({
      where: { tenantId, OR: [{ plate: t }, { chassi: t }] },
    });
    if (sga) {
      return {
        origem: 'ESPELHO_SGA',
        plate: sga.plate || undefined,
        chassi: sga.chassi ?? undefined,
        brand: sga.brandModel,
        clientName: sga.associateName,
        cpfCnpj: sga.cpf ?? undefined,
        phone: sga.phone ?? undefined,
        email: sga.email ?? undefined,
        sgaSituation: sga.situationLabel,
      };
    }

    return null;
  }

  // ---------------------------------------------------------------- privados

  private validarServico(
    tipo: CriarAgendamento['serviceType'],
    motivo: CriarAgendamento['maintenanceReason'],
  ) {
    if (exigeMotivoManutencao(tipo) && !motivo) {
      throw new BadRequestException('Manutenção exige o motivo.');
    }
    if (!exigeMotivoManutencao(tipo) && motivo) {
      throw new BadRequestException(
        'Motivo de manutenção só vale para serviço de manutenção.',
      );
    }
  }

  private periodo(dados: {
    date: string;
    shift: CriarAgendamento['shift'];
    startTime?: string | null;
    endTime?: string | null;
  }) {
    try {
      return periodoDoTurno(
        dados.date,
        dados.shift,
        dados.startTime,
        dados.endTime,
      );
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /// Sequencial por tenant, contínuo. Conta o que existe e soma um; o unique
  /// em (tenant, osNumber) é a rede de segurança contra corrida.
  private async proximoNumeroOs(tenantId: string, agora: Date) {
    const total = await this.prisma.appointment.count({ where: { tenantId } });
    for (let tentativa = 0; tentativa < 20; tentativa++) {
      const candidato = numeroOs(agora, total + 1 + tentativa);
      const existe = await this.prisma.appointment.findFirst({
        where: { tenantId, osNumber: candidato },
        select: { id: true },
      });
      if (!existe) return candidato;
    }
    throw new BadRequestException('Não foi possível gerar o número da OS.');
  }

  /// Formato que o calendário consome. Cor vem do tipo de serviço e ícone do
  /// status: as duas coisas separadas, como na origem.
  private paraEvento(a: {
    id: string;
    osNumber: string;
    serviceType: string;
    status: string;
    technicianStatus: string | null;
    executionTiming: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    plate: string | null;
    clientName: string | null;
    address: string | null;
    autoScheduled: boolean;
    technicianReply: string | null;
    locationDenied: boolean;
    technician: { id: string; name: string };
  }) {
    return {
      id: a.id,
      osNumber: a.osNumber,
      serviceType: a.serviceType,
      status: a.status,
      technicianStatus: a.technicianStatus,
      executionTiming: a.executionTiming,
      start: a.scheduledStart,
      end: a.scheduledEnd,
      plate: a.plate,
      clientName: a.clientName,
      address: a.address,
      autoScheduled: a.autoScheduled,
      hasTechnicianReply: Boolean(a.technicianReply),
      locationDenied: a.locationDenied,
      technicianId: a.technician.id,
      technicianName: a.technician.name,
      /// Divergência entre o que a OS diz e o que o técnico declarou.
      statusDiverge:
        a.technicianStatus != null &&
        !mesmoDesfecho(a.status, a.technicianStatus),
    };
  }
}

function isoDia(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/// O status do técnico é mais grosso que o da OS: CONCLUÍDO do técnico casa
/// tanto com COMPLETED quanto com EXECUTED.
function mesmoDesfecho(status: string, doTecnico: string): boolean {
  const equivalentes: Record<string, string[]> = {
    SCHEDULED: ['SCHEDULED', 'POSTPONED', 'ANTICIPATED'],
    COMPLETED: ['COMPLETED', 'EXECUTED'],
    CANCELED: ['CANCELED', 'CANCELED_BY_CLIENT', 'CLOSED_BY_SYSTEM'],
    FRUSTRATED: [
      'FRUSTRATED_CLIENT',
      'FRUSTRATED_TECHNICIAN',
      'CLIENT_NO_SHOW',
    ],
  };
  return (equivalentes[doTecnico] ?? []).includes(status);
}
