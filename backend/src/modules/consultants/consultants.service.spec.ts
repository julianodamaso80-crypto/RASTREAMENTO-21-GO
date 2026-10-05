import { ConsultantsService } from './consultants.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PowerPanelClient } from './power-panel.client';
import type { ConfigService } from '@nestjs/config';
import type { UsuarioPower } from './consultants.mapper';

/**
 * A gravação dos consultores precisa ser SQL cru em lote: o `$transaction` com
 * 250 `upsert` enchia o cache de planos do Prisma (3,4 MB por lote, a cada
 * 30 min) até o backend cair por falta de heap, e ainda estourava o limite da
 * transação (05/10/2026).
 */

const TENANT = '11111111-1111-1111-1111-111111111111';

function usuario(id: number, extra: Partial<UsuarioPower> = {}): UsuarioPower {
  return {
    id,
    name: `Nome ${id}`,
    fullName: `Nome Completo ${id}`,
    email: null,
    registration: null,
    office: 4,
    officeString: 'Consultor',
    branchString: null,
    cooperativeString: null,
    active: true,
    responsibleUser: null,
    statusString: null,
    isLeader: null,
    hinovaPayId: null,
    userId: null,
    companyId: null,
    companyUserPhone: null,
    companyUserMobile: null,
    createdAt: '',
    lastAccess: '',
    blockedAt: '',
    groupPermission: null,
    leader: null,
    ...extra,
  };
}

function montar(usuarios: UsuarioPower[]) {
  const prisma = {
    $executeRaw: jest.fn().mockResolvedValue(usuarios.length),
    $transaction: jest.fn(),
    consultant: {
      upsert: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(1),
    },
  };
  const power = {
    configurado: true,
    listarUsuarios: jest.fn().mockResolvedValue({
      content: usuarios,
      totalElements: usuarios.length,
      totalPages: 1,
    }),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const service = new ConsultantsService(
    prisma as unknown as PrismaService,
    power as unknown as PowerPanelClient,
    config as unknown as ConfigService,
  );
  return { service, prisma };
}

describe('ConsultantsService.sincronizar', () => {
  it('grava em SQL cru por lote, nunca em $transaction de upserts', async () => {
    const usuarios = Array.from({ length: 600 }, (_, i) => usuario(i + 1));
    const { service, prisma } = montar(usuarios);

    const total = await service.sincronizar(TENANT);

    expect(total).toBe(600);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.consultant.upsert).not.toHaveBeenCalled();
    // 600 pessoas em lotes de 250 = 3 idas ao banco.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('manda as colunas como arrays do mesmo tamanho do lote, com vazio no lugar de null', async () => {
    const usuarios = [
      usuario(10, { email: 'a@b.com', createdAt: '01/02/2026 10:00', office: null }),
      usuario(11),
    ];
    const { service, prisma } = montar(usuarios);

    await service.sincronizar(TENANT);

    const sql = prisma.$executeRaw.mock.calls[0][0] as { values: unknown[]; sql: string };
    expect(sql.sql).toContain('ON CONFLICT (tenant_id, power_id)');
    const arrays = sql.values.filter((v): v is unknown[] => Array.isArray(v));
    // 18 colunas vindas do Power viajam como array.
    expect(arrays).toHaveLength(18);
    for (const a of arrays) expect(a).toHaveLength(2);
    expect(arrays[0]).toEqual([10, 11]); // power_id
    expect(arrays[3]).toEqual(['a@b.com', '']); // email: null vira ''
    expect(arrays[7]).toEqual(['', '4']); // office: inteiro opcional como texto
    expect(arrays[15][0]).toBe('2026-02-01T13:00:00.000Z'); // data do Power em UTC
    expect(arrays[15][1]).toBe('');
    // Nenhum null solto dentro dos arrays: o SQL converte '' em NULL.
    for (const a of arrays) expect(a.some((x) => x == null)).toBe(false);
  });

  it('marca como removido quem não veio numa coleta completa', async () => {
    const { service, prisma } = montar([usuario(1)]);
    prisma.consultant.updateMany.mockResolvedValue({ count: 2 });

    await service.sincronizar(TENANT);

    expect(prisma.consultant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT, deletedAt: null }),
        data: { deletedAt: expect.any(Date) },
      }),
    );
  });
});
