import { NotFoundException } from '@nestjs/common';
import { FinancialService } from './financial.service';
import type { PrismaService } from '../prisma/prisma.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

function prismaFalso() {
  return {
    financialEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'novo', ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'x', ...data })),
    },
    consultant: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

describe('FinancialService', () => {
  it('lista só a empresa do usuário e ignora excluídos', async () => {
    const prisma = prismaFalso();
    const service = new FinancialService(prisma as unknown as PrismaService);
    await service.findAll(TENANT, ' srl5 ', 'PAID_PIX', 9);
    const { where } = prisma.financialEntry.findMany.mock.calls[0][0];
    expect(where.tenantId).toBe(TENANT);
    expect(where.deletedAt).toBeNull();
    expect(where.status).toBe('PAID_PIX');
    expect(where.month).toBe(9);
    expect(where.OR[0].plate.contains).toBe('srl5');
  });

  it('descarta situação e mês que não existem no filtro', async () => {
    const prisma = prismaFalso();
    const service = new FinancialService(prisma as unknown as PrismaService);
    await service.findAll(TENANT, '', 'QUALQUER', 13);
    const { where } = prisma.financialEntry.findMany.mock.calls[0][0];
    expect(where.status).toBeUndefined();
    expect(where.month).toBeUndefined();
    expect(where.OR).toBeUndefined();
  });

  it('filtra pelo período do lançamento e ignora data inválida', async () => {
    const prisma = prismaFalso();
    const service = new FinancialService(prisma as unknown as PrismaService);
    await service.findAll(TENANT, '', '', undefined, '2026-09-14T03:00:00.000Z', '2026-09-21T03:00:00.000Z');
    expect(prisma.financialEntry.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2026-09-14T03:00:00.000Z'),
      lt: new Date('2026-09-21T03:00:00.000Z'),
    });

    await service.findAll(TENANT, '', '', undefined, 'ontem', undefined);
    expect(prisma.financialEntry.findMany.mock.calls[1][0].where.createdAt).toBeUndefined();
  });

  it('busca consultor só na empresa do usuário e não lista a base inteira sem termo', async () => {
    const prisma = prismaFalso();
    const service = new FinancialService(prisma as unknown as PrismaService);
    expect(await service.searchConsultants(TENANT, '  ')).toEqual([]);
    expect(prisma.consultant.findMany).not.toHaveBeenCalled();

    await service.searchConsultants(TENANT, 'ramon');
    const { where, take } = prisma.consultant.findMany.mock.calls[0][0];
    expect(where.tenantId).toBe(TENANT);
    expect(where.deletedAt).toBeNull();
    expect(where.OR[0].name.contains).toBe('ramon');
    expect(take).toBe(15);
  });

  describe('vínculo feito no Estoque abre a linha do Financeiro', () => {
    it('nasce em SEM COMPROVANTE com o celular do consultor', async () => {
      const prisma = prismaFalso();
      prisma.consultant.findFirst.mockResolvedValue({
        mobile: '21998345046',
        phone: null,
      });
      const service = new FinancialService(prisma as unknown as PrismaService);
      await service.registrarVinculo({
        tenantId: TENANT,
        plate: ' srl5a25 ',
        consultantName: ' Ramon Pontes Araujo ',
      });
      const { data } = prisma.financialEntry.create.mock.calls[0][0];
      expect(data).toMatchObject({
        tenantId: TENANT,
        plate: 'SRL5A25',
        status: 'NO_RECEIPT',
        consultantName: 'RAMON PONTES ARAUJO',
        consultantContact: '(21) 99834-5046',
      });
    });

    it('sem consultor na pendência a linha vem só com a placa', async () => {
      const prisma = prismaFalso();
      const service = new FinancialService(prisma as unknown as PrismaService);
      await service.registrarVinculo({ tenantId: TENANT, plate: 'SRL5A25' });
      expect(prisma.consultant.findFirst).not.toHaveBeenCalled();
      expect(prisma.financialEntry.create.mock.calls[0][0].data).toMatchObject({
        consultantName: null,
        consultantContact: null,
      });
    });

    it('placa que já tem lançamento aberto não ganha outro', async () => {
      const prisma = prismaFalso();
      prisma.financialEntry.findFirst.mockResolvedValue({ id: 'ja-existe' });
      const service = new FinancialService(prisma as unknown as PrismaService);
      expect(await service.registrarVinculo({ tenantId: TENANT, plate: 'SRL5A25' })).toBeNull();
      expect(prisma.financialEntry.create).not.toHaveBeenCalled();
    });
  });

  it('exclusão é soft delete e não mexe em lançamento de outra empresa', async () => {
    const prisma = prismaFalso();
    const service = new FinancialService(prisma as unknown as PrismaService);
    await expect(service.remove('x', TENANT)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.financialEntry.findFirst.mock.calls[0][0].where.tenantId).toBe(TENANT);
    expect(prisma.financialEntry.update).not.toHaveBeenCalled();

    prisma.financialEntry.findFirst.mockResolvedValue({ id: 'x' });
    await service.remove('x', TENANT);
    expect(prisma.financialEntry.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
  });
});
