import { AppointmentsService } from './appointments.service';
import {
  diasDoPeriodo,
  emAberto,
  janelasDosCards,
} from './appointments.regras';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * As abas Análise e Ordens de Serviço copiam regras da origem que não são
 * óbvias olhando a tela: excluir e duplicar só em OS aberta, período de no
 * máximo 90 dias, filtro pela data de conclusão e contagem dos cards.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';

function prismaFalso() {
  return {
    appointment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'novo', ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'x', ...data })),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    technician: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

type Falso = ReturnType<typeof prismaFalso>;
const servico = (p: Falso) => new AppointmentsService(p as unknown as PrismaService);

const dia = (a: number, m: number, d: number, h = 0, min = 0) =>
  new Date(a, m - 1, d, h, min, 0, 0);

describe('regras das abas', () => {
  it('só agendado, prorrogado e adiantado estão em aberto', () => {
    expect(emAberto('SCHEDULED')).toBe(true);
    expect(emAberto('POSTPONED')).toBe(true);
    expect(emAberto('ANTICIPATED')).toBe(true);
    expect(emAberto('COMPLETED')).toBe(false);
    expect(emAberto('CANCELED')).toBe(false);
    expect(emAberto('FRUSTRATED_CLIENT')).toBe(false);
  });

  it('conta os dias do período incluindo os dois extremos', () => {
    expect(diasDoPeriodo(dia(2026, 9, 5), dia(2026, 9, 11, 23, 59))).toBe(7);
    expect(diasDoPeriodo(dia(2026, 9, 11), dia(2026, 9, 11, 23, 59))).toBe(1);
  });

  it('período acima de 90 dias ou invertido não passa', () => {
    expect(() => diasDoPeriodo(dia(2026, 1, 1), dia(2026, 6, 1))).toThrow('90 dias');
    expect(() => diasDoPeriodo(dia(2026, 9, 11), dia(2026, 9, 1))).toThrow();
  });

  it('cards: resto de hoje, próximos 7 dias e do 8º ao 30º', () => {
    const agora = dia(2026, 9, 11, 17, 49);
    const j = janelasDosCards(agora);
    expect(j.hoje.inicio).toEqual(agora);
    expect(j.hoje.fim.getDate()).toBe(11);
    expect(j.hoje.fim.getHours()).toBe(23);
    expect(j.semana.inicio).toEqual(dia(2026, 9, 12));
    expect(j.semana.fim.getDate()).toBe(18);
    expect(j.mes.inicio).toEqual(dia(2026, 9, 19));
    expect(j.mes.fim.getMonth()).toBe(9); // outubro
    expect(j.mes.fim.getDate()).toBe(11);
  });
});

describe('excluir e duplicar', () => {
  it('OS concluída não se exclui', async () => {
    const p = prismaFalso();
    p.appointment.findFirst.mockResolvedValue({ id: 'a', status: 'COMPLETED' });
    await expect(servico(p).remover(TENANT, 'a')).rejects.toThrow(
      'agendado, prorrogado ou adiantado',
    );
    expect(p.appointment.update).not.toHaveBeenCalled();
  });

  it('OS agendada sai por soft delete', async () => {
    const p = prismaFalso();
    p.appointment.findFirst.mockResolvedValue({ id: 'a', status: 'SCHEDULED' });
    await servico(p).remover(TENANT, 'a');
    expect(p.appointment.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
  });

  it('duplicar copia a ficha com número novo e volta a agendado', async () => {
    const p = prismaFalso();
    p.appointment.findFirst
      .mockResolvedValueOnce({
        id: 'a',
        status: 'POSTPONED',
        osNumber: '20260910/1',
        serviceType: 'INSTALLATION',
        plate: 'SRW5G97',
        clientName: 'GUILHERME',
        technicianId: 't1',
        scheduledStart: dia(2026, 9, 18, 16),
        scheduledEnd: dia(2026, 9, 18, 18),
        value: 0,
      })
      .mockResolvedValue(null); // número de OS livre
    p.appointment.count.mockResolvedValue(1);

    const nova = await servico(p).duplicar(TENANT, 'a', 'u1');
    expect(nova.osNumber).not.toBe('20260910/1');
    expect(nova.plate).toBe('SRW5G97');
    expect(nova.createdById).toBe('u1');
    // status fica no default do banco (SCHEDULED): a cópia não herda o prorrogado
    expect((nova as Record<string, unknown>).status).toBeUndefined();
  });

  it('duplicar OS cancelada não passa', async () => {
    const p = prismaFalso();
    p.appointment.findFirst.mockResolvedValue({ id: 'a', status: 'CANCELED' });
    await expect(servico(p).duplicar(TENANT, 'a')).rejects.toThrow();
    expect(p.appointment.create).not.toHaveBeenCalled();
  });
});

describe('lista de ordens de serviço', () => {
  const base = {
    from: dia(2026, 9, 8),
    to: dia(2026, 9, 18, 23, 59),
  };

  it('pela data do agendamento filtra scheduledStart e ordena do mais distante', async () => {
    const p = prismaFalso();
    await servico(p).lista(TENANT, { ...base, tipoData: 'AGENDAMENTO', status: ['SCHEDULED'] });
    const arg = p.appointment.findMany.mock.calls[0][0];
    expect(arg.where.tenantId).toBe(TENANT);
    expect(arg.where.deletedAt).toBeNull();
    expect(arg.where.scheduledStart).toEqual({ gte: base.from, lte: base.to });
    expect(arg.where.status).toEqual({ in: ['SCHEDULED'] });
    expect(arg.orderBy[0]).toEqual({ scheduledStart: 'desc' });
  });

  it('pela data de conclusão não olha o agendamento', async () => {
    const p = prismaFalso();
    await servico(p).lista(TENANT, { ...base, tipoData: 'CONCLUSAO' });
    const arg = p.appointment.findMany.mock.calls[0][0];
    expect(arg.where.scheduledStart).toBeUndefined();
    expect(JSON.stringify(arg.where.AND)).toContain('completedAt');
  });

  it('filtra pelo usuário que criou', async () => {
    const p = prismaFalso();
    await servico(p).lista(TENANT, { ...base, tipoData: 'AGENDAMENTO', createdByIds: ['u1'] });
    expect(p.appointment.findMany.mock.calls[0][0].where.createdById).toEqual({ in: ['u1'] });
  });

  it('período acima de 90 dias não consulta', async () => {
    const p = prismaFalso();
    await expect(
      servico(p).lista(TENANT, { from: dia(2026, 1, 1), to: dia(2026, 9, 1), tipoData: 'AGENDAMENTO' }),
    ).rejects.toThrow('90 dias');
    expect(p.appointment.findMany).not.toHaveBeenCalled();
  });
});

describe('gráficos da análise', () => {
  const periodo = { from: dia(2026, 9, 5), to: dia(2026, 9, 11, 23, 59) };

  it('por técnico troca id por nome e ordena do maior para o menor', async () => {
    const p = prismaFalso();
    p.appointment.groupBy.mockResolvedValue([
      { technicianId: 't1', _count: { _all: 3 } },
      { technicianId: 't2', _count: { _all: 37 } },
    ]);
    p.technician.findMany.mockResolvedValue([
      { id: 't1', name: 'Pablo' },
      { id: 't2', name: 'Gabriel' },
    ]);
    const r = await servico(p).grafico(TENANT, 'tecnicos', periodo);
    expect(r.dias).toBe(7);
    expect(r.itens.map((i) => [i.nome, i.qtd])).toEqual([
      ['Gabriel', 37],
      ['Pablo', 3],
    ]);
  });

  it('status sempre traz todas as barras, mesmo zeradas, na ordem da origem', async () => {
    const p = prismaFalso();
    p.appointment.groupBy.mockResolvedValue([
      { status: 'COMPLETED', _count: { _all: 99 } },
      { status: 'SCHEDULED', _count: { _all: 94 } },
    ]);
    const r = await servico(p).grafico(TENANT, 'status', periodo);
    expect(r.itens.slice(0, 3).map((i) => [i.chave, i.qtd])).toEqual([
      ['SCHEDULED', 94],
      ['CANCELED', 0],
      ['COMPLETED', 99],
    ]);
  });

  it('motivo de manutenção conta só manutenção e respeita o motivo escolhido', async () => {
    const p = prismaFalso();
    await servico(p).grafico(TENANT, 'motivos-manutencao', {
      ...periodo,
      maintenanceReason: 'SIGNAL_FAILURE',
    });
    const where = p.appointment.groupBy.mock.calls[0][0].where;
    expect(where.serviceType).toBe('MAINTENANCE');
    expect(where.maintenanceReason).toBe('SIGNAL_FAILURE');
    expect(where.tenantId).toBe(TENANT);
  });

  it('por usuário conta pela data de criação, não pelo agendamento', async () => {
    const p = prismaFalso();
    await servico(p).grafico(TENANT, 'usuarios', periodo);
    const where = p.appointment.groupBy.mock.calls[0][0].where;
    expect(where.createdAt).toEqual({ gte: periodo.from, lte: periodo.to });
    expect(where.scheduledStart).toBeUndefined();
  });

  it('cards contam só OS ainda por executar', async () => {
    const p = prismaFalso();
    p.appointment.count.mockResolvedValueOnce(45).mockResolvedValueOnce(227).mockResolvedValueOnce(151);
    const r = await servico(p).analiseResumo(TENANT, dia(2026, 9, 11, 17));
    expect(r).toEqual({ hoje: 45, semana: 227, mes: 151 });
    expect(p.appointment.count.mock.calls[0][0].where.status).toEqual({
      in: ['SCHEDULED', 'POSTPONED', 'ANTICIPATED'],
    });
  });
});
