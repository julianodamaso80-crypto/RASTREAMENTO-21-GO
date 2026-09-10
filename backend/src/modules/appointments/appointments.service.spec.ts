import { AppointmentsService } from './appointments.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * As regras que a plataforma de origem impõe e que copiamos de propósito:
 * manutenção sem motivo não entra, cancelamento sem observação não entra, e
 * desfecho sem coordenada fica marcado em vez de passar batido.
 *
 * E as duas que são nossas: a fila de serviços a agendar vem do espelho do SGA
 * (não da digitação) e o formulário se preenche por placa mesmo quando o
 * veículo ainda não é um ativo nosso.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const TECNICO = '22222222-2222-2222-2222-222222222222';

const TECNICO_ATIVO = { id: TECNICO, active: true };

interface PrismaFalso {
  appointment: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  technician: { findFirst: jest.Mock };
  vehicle: { findFirst: jest.Mock };
  installationPending: { findMany: jest.Mock; findFirst: jest.Mock };
  sgaVehicle: { findFirst: jest.Mock };
}

function prismaFalso(): PrismaFalso {
  return {
    appointment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'novo', ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'x', ...data })),
      count: jest.fn().mockResolvedValue(0),
    },
    technician: { findFirst: jest.fn().mockResolvedValue(TECNICO_ATIVO) },
    vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
    installationPending: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    sgaVehicle: { findFirst: jest.fn().mockResolvedValue(null) },
  };
}

function servico(p: PrismaFalso) {
  return new AppointmentsService(p as unknown as PrismaService);
}

const BASE = {
  serviceType: 'INSTALLATION' as const,
  date: '2026-09-15',
  shift: 'MORNING' as const,
  technicianId: TECNICO,
};

describe('criar agendamento', () => {
  it('grava o período do turno escolhido', async () => {
    const p = prismaFalso();
    await servico(p).criar(TENANT, BASE);

    const { data } = p.appointment.create.mock.calls[0][0];
    expect(data.scheduledStart.getHours()).toBe(8);
    expect(data.scheduledEnd.getHours()).toBe(12);
    expect(data.tenantId).toBe(TENANT);
  });

  it('numera a OS no formato da origem', async () => {
    const p = prismaFalso();
    p.appointment.count.mockResolvedValue(24013);
    await servico(p).criar(TENANT, BASE);

    const { data } = p.appointment.create.mock.calls[0][0];
    expect(data.osNumber).toMatch(/^\d{8}\/24014$/);
  });

  it('manutenção sem motivo não entra', async () => {
    const p = prismaFalso();
    await expect(
      servico(p).criar(TENANT, { ...BASE, serviceType: 'MAINTENANCE' }),
    ).rejects.toThrow(/motivo/i);
    expect(p.appointment.create).not.toHaveBeenCalled();
  });

  it('motivo de manutenção em instalação não entra', async () => {
    const p = prismaFalso();
    await expect(
      servico(p).criar(TENANT, { ...BASE, maintenanceReason: 'WORKSHOP' }),
    ).rejects.toThrow(/só vale para/i);
  });

  it('técnico inativo não recebe agendamento', async () => {
    const p = prismaFalso();
    p.technician.findFirst.mockResolvedValue({ id: TECNICO, active: false });
    await expect(servico(p).criar(TENANT, BASE)).rejects.toThrow(/inativo/i);
  });

  it('turno customizável sem hora não entra', async () => {
    const p = prismaFalso();
    await expect(
      servico(p).criar(TENANT, { ...BASE, shift: 'CUSTOM' }),
    ).rejects.toThrow(/hora de início/i);
  });
});

describe('mudar status', () => {
  const AGENDADO = {
    id: 'a1',
    scheduledStart: new Date(2026, 8, 15, 8, 0),
    scheduledEnd: new Date(2026, 8, 15, 12, 0),
    status: 'SCHEDULED',
    technicianStatus: null,
    completedAt: null,
    completedLat: null,
    completedLng: null,
    locationDenied: false,
    executionTiming: 'ON_TIME',
  };

  it('cancelar sem observação não passa', async () => {
    const p = prismaFalso();
    p.appointment.findFirst.mockResolvedValue(AGENDADO);
    await expect(
      servico(p).mudarStatus(TENANT, 'a1', { status: 'CANCELED' }),
    ).rejects.toThrow(/observação/i);
    expect(p.appointment.update).not.toHaveBeenCalled();
  });

  it('visita frustrada com observação passa', async () => {
    const p = prismaFalso();
    p.appointment.findFirst.mockResolvedValue(AGENDADO);
    await servico(p).mudarStatus(TENANT, 'a1', {
      status: 'FRUSTRATED_CLIENT',
      note: 'cliente não estava no endereço',
      lat: -22.7,
      lng: -43.4,
    });
    const { data } = p.appointment.update.mock.calls[0][0];
    expect(data.status).toBe('FRUSTRATED_CLIENT');
    expect(data.statusNote).toBe('cliente não estava no endereço');
  });

  it('concluir sem coordenada marca a OS como sem localização', async () => {
    const p = prismaFalso();
    p.appointment.findFirst.mockResolvedValue(AGENDADO);
    await servico(p).mudarStatus(TENANT, 'a1', { status: 'COMPLETED' });

    const { data } = p.appointment.update.mock.calls[0][0];
    expect(data.locationDenied).toBe(true);
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('cancelar no escritório NÃO marca como sem localização', async () => {
    // Cancelamento não é desfecho declarado em campo: exigir GPS aí encheria a
    // grade de aviso falso em OS que ninguém foi visitar.
    const p = prismaFalso();
    p.appointment.findFirst.mockResolvedValue(AGENDADO);
    await servico(p).mudarStatus(TENANT, 'a1', {
      status: 'CANCELED',
      note: 'cliente desistiu',
    });

    const { data } = p.appointment.update.mock.calls[0][0];
    expect(data.locationDenied).toBe(false);
  });

  it('visita frustrada sem coordenada marca', async () => {
    const p = prismaFalso();
    p.appointment.findFirst.mockResolvedValue(AGENDADO);
    await servico(p).mudarStatus(TENANT, 'a1', {
      status: 'FRUSTRATED_TECHNICIAN',
      note: 'não consegui acesso',
    });

    const { data } = p.appointment.update.mock.calls[0][0];
    expect(data.locationDenied).toBe(true);
  });

  it('concluir com coordenada não marca', async () => {
    const p = prismaFalso();
    p.appointment.findFirst.mockResolvedValue(AGENDADO);
    await servico(p).mudarStatus(TENANT, 'a1', {
      status: 'COMPLETED',
      lat: -22.74,
      lng: -43.43,
    });

    const { data } = p.appointment.update.mock.calls[0][0];
    expect(data.locationDenied).toBe(false);
    expect(data.completedLat).toBe(-22.74);
  });
});

describe('remarcar arrastando', () => {
  it('fim antes do início não passa', async () => {
    const p = prismaFalso();
    p.appointment.findFirst.mockResolvedValue({ id: 'a1' });
    await expect(
      servico(p).remarcar(
        TENANT,
        'a1',
        new Date(2026, 8, 15, 14, 0),
        new Date(2026, 8, 15, 9, 0),
      ),
    ).rejects.toThrow(/não pode ser anterior/i);
  });

  it('recalcula o turno pelo novo horário', async () => {
    const p = prismaFalso();
    p.appointment.findFirst.mockResolvedValue({ id: 'a1' });
    await servico(p).remarcar(
      TENANT,
      'a1',
      new Date(2026, 8, 16, 13, 0),
      new Date(2026, 8, 16, 18, 0),
    );
    const { data } = p.appointment.update.mock.calls[0][0];
    expect(data.shift).toBe('AFTERNOON');
  });
});

describe('fila de serviços a agendar', () => {
  const PENDENCIA = {
    id: 'p1',
    plate: 'RFQ8B04',
    chassi: null,
    associateName: 'JEFERSON DE JESUS RIBEIRO',
    cpf: '14173561709',
    phone: '21981824867',
    email: null,
    brandModel: 'Fiat UNO',
    city: 'Nova Iguaçu',
    neighborhood: 'Rancho Novo',
    cep: '26000000',
    street: 'Rua Joaquim Quaresma',
    number: '207',
    lat: -22.74,
    lng: -43.43,
    contractDate: new Date(2026, 8, 1),
  };

  it('traz a pendência do espelho do SGA pronta para virar OS', async () => {
    const p = prismaFalso();
    p.installationPending.findMany.mockResolvedValue([PENDENCIA]);

    const fila = await servico(p).pendencias(TENANT);
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({
      plate: 'RFQ8B04',
      clientName: 'JEFERSON DE JESUS RIBEIRO',
      address: 'Rua Joaquim Quaresma, 207',
      serviceType: 'INSTALLATION',
    });
  });

  it('quem já tem OS aberta sai da fila', async () => {
    const p = prismaFalso();
    p.appointment.findMany.mockResolvedValue([{ installationPendingId: 'p1' }]);
    p.installationPending.findMany.mockResolvedValue([]);

    await servico(p).pendencias(TENANT);

    const { where } = p.installationPending.findMany.mock.calls[0][0];
    expect(where.id).toEqual({ notIn: ['p1'] });
  });

  it('veículo sem placa entra pelo chassi', async () => {
    const p = prismaFalso();
    p.installationPending.findMany.mockResolvedValue([
      { ...PENDENCIA, plate: '', chassi: '9C2KC2500TR163224' },
    ]);

    const fila = await servico(p).pendencias(TENANT);
    expect(fila[0].plate).toBe('9C2KC2500TR163224');
  });
});

describe('preencher por placa', () => {
  it('acha o ativo e traz cliente, IMEI e local de instalação', async () => {
    const p = prismaFalso();
    p.vehicle.findFirst.mockResolvedValue({
      id: 'v1',
      plate: 'RFQ8B04',
      chassi: '9BW',
      brand: 'Fiat',
      model: 'UNO',
      sgaStatusLabel: 'ATIVO',
      associate: {
        name: 'JEFERSON',
        cpf: '14173561709',
        phone: '21981824867',
        email: null,
      },
      device: { imei: '866557086559061', installLocation: 'TG carpete' },
    });

    const r = await servico(p).preencherPorPlaca(TENANT, 'rfq8b04');
    expect(r).toMatchObject({
      origem: 'ATIVO',
      vehicleId: 'v1',
      imei: '866557086559061',
      installLocation: 'TG carpete',
      clientName: 'JEFERSON',
      sgaSituation: 'ATIVO',
    });
  });

  it('sem ativo, cai na pendência do SGA e já amarra a OS nela', async () => {
    const p = prismaFalso();
    p.installationPending.findFirst.mockResolvedValue({
      id: 'p1',
      plate: 'LUS6A46',
      chassi: null,
      brandModel: 'Honda CG 160',
      associateName: 'MARIA',
      cpf: '111',
      phone: null,
      email: null,
      cep: '26000000',
      street: 'Rua A',
      number: '10',
      neighborhood: 'Centro',
      city: 'Mangaratiba',
      lat: -22.9,
      lng: -44.0,
    });

    const r = await servico(p).preencherPorPlaca(TENANT, 'LUS6A46');
    expect(r).toMatchObject({
      origem: 'PENDENCIA_SGA',
      installationPendingId: 'p1',
      clientName: 'MARIA',
      address: 'Rua A, 10, Centro, Mangaratiba',
    });
  });

  it('sem ativo e sem pendência, responde o espelho cadastral com a situação', async () => {
    const p = prismaFalso();
    p.sgaVehicle.findFirst.mockResolvedValue({
      plate: 'ABC1D23',
      chassi: null,
      brandModel: 'VW GOL',
      associateName: 'JOÃO',
      cpf: '222',
      phone: null,
      email: null,
      situationLabel: 'INADIMPLENTE',
    });

    const r = await servico(p).preencherPorPlaca(TENANT, 'ABC1D23');
    expect(r).toMatchObject({
      origem: 'ESPELHO_SGA',
      clientName: 'JOÃO',
      sgaSituation: 'INADIMPLENTE',
    });
  });

  it('termo curto não consulta nada', async () => {
    const p = prismaFalso();
    const r = await servico(p).preencherPorPlaca(TENANT, 'AB');
    expect(r).toBeNull();
    expect(p.vehicle.findFirst).not.toHaveBeenCalled();
  });

  it('não achou em lugar nenhum devolve nulo', async () => {
    const p = prismaFalso();
    const r = await servico(p).preencherPorPlaca(TENANT, 'ZZZ9Z99');
    expect(r).toBeNull();
  });
});

describe('agenda do calendário', () => {
  it('filtra por tenant, período e técnicos', async () => {
    const p = prismaFalso();
    await servico(p).agenda(TENANT, {
      from: new Date(2026, 8, 1),
      to: new Date(2026, 8, 30),
      technicianIds: [TECNICO],
    });

    const { where } = p.appointment.findMany.mock.calls[0][0];
    expect(where.tenantId).toBe(TENANT);
    expect(where.deletedAt).toBeNull();
    expect(where.technicianId).toEqual({ in: [TECNICO] });
  });

  it('marca divergência entre o status da OS e o que o técnico declarou', async () => {
    const p = prismaFalso();
    p.appointment.findMany.mockResolvedValue([
      {
        id: 'a1',
        osNumber: '20260902/1',
        serviceType: 'INSTALLATION',
        status: 'SCHEDULED',
        technicianStatus: 'COMPLETED',
        executionTiming: 'ON_TIME',
        scheduledStart: new Date(),
        scheduledEnd: new Date(),
        plate: 'RFQ8B04',
        clientName: 'X',
        address: null,
        autoScheduled: false,
        technicianReply: null,
        locationDenied: false,
        technician: { id: TECNICO, name: 'CAUÃ' },
      },
    ]);

    const [ev] = await servico(p).agenda(TENANT, {
      from: new Date(),
      to: new Date(),
    });
    expect(ev.statusDiverge).toBe(true);
  });

  it('técnico concluído com OS concluída não é divergência', async () => {
    const p = prismaFalso();
    p.appointment.findMany.mockResolvedValue([
      {
        id: 'a1',
        osNumber: '20260902/1',
        serviceType: 'INSTALLATION',
        status: 'COMPLETED',
        technicianStatus: 'COMPLETED',
        executionTiming: 'ON_TIME',
        scheduledStart: new Date(),
        scheduledEnd: new Date(),
        plate: null,
        clientName: null,
        address: null,
        autoScheduled: false,
        technicianReply: 'ok',
        locationDenied: false,
        technician: { id: TECNICO, name: 'CAUÃ' },
      },
    ]);

    const [ev] = await servico(p).agenda(TENANT, {
      from: new Date(),
      to: new Date(),
    });
    expect(ev.statusDiverge).toBe(false);
    expect(ev.hasTechnicianReply).toBe(true);
  });
});
