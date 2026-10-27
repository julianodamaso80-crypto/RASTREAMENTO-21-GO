import { associadoPodeUsarApp, placasComAcesso } from './acesso-app';

function prismaCom(
  veiculos: { plate: string; tenantId: string }[],
  sga: { plate: string; tenantId: string; situationCode: string }[],
) {
  return {
    vehicle: { findMany: jest.fn().mockResolvedValue(veiculos) },
    sgaVehicle: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          sga.filter((s) =>
            where.situationCode.in.includes(s.situationCode) &&
            where.plate.in.includes(s.plate),
          ),
        ),
      ),
    },
  } as any;
}

describe('acesso ao app pela situação do SGA', () => {
  afterEach(() => delete process.env.APP_ASSOCIATE_ALLOWLIST);

  it('INATIVO no SGA não usa o app, mesmo com rastreador instalado', async () => {
    const prisma = prismaCom(
      [{ plate: 'TUL8G62', tenantId: 't1' }],
      [{ plate: 'TUL8G62', tenantId: 't1', situationCode: '2' }],
    );
    expect(await placasComAcesso(prisma, 'a1')).toEqual([]);
    expect(await associadoPodeUsarApp(prisma, { id: 'a1', cpf: '15512006789' })).toBe(false);
  });

  it('INADIMPLENTE no SGA também não usa', async () => {
    const prisma = prismaCom(
      [{ plate: 'AAA1B23', tenantId: 't1' }],
      [{ plate: 'AAA1B23', tenantId: 't1', situationCode: '4' }],
    );
    expect(await associadoPodeUsarApp(prisma, { id: 'a1', cpf: '1' })).toBe(false);
  });

  it('ATIVO e veículo fora do espelho continuam com acesso', async () => {
    const prisma = prismaCom(
      [
        { plate: 'AAA1B23', tenantId: 't1' },
        { plate: 'BBB2C34', tenantId: 't1' },
      ],
      [{ plate: 'AAA1B23', tenantId: 't1', situationCode: '1' }],
    );
    expect(await placasComAcesso(prisma, 'a1')).toEqual(['AAA1B23', 'BBB2C34']);
  });

  it('com dois veículos, só o inativo fica de fora', async () => {
    const prisma = prismaCom(
      [
        { plate: 'AAA1B23', tenantId: 't1' },
        { plate: 'BBB2C34', tenantId: 't1' },
      ],
      [{ plate: 'BBB2C34', tenantId: 't1', situationCode: '2' }],
    );
    expect(await placasComAcesso(prisma, 'a1')).toEqual(['AAA1B23']);
  });

  it('a consulta exclui acesso cortado no painel e device sem instalação', async () => {
    const prisma = prismaCom([], []);
    await placasComAcesso(prisma, 'a1');
    const where = prisma.vehicle.findMany.mock.calls[0][0].where;
    expect(where.appAccessBlocked).toBe(false);
    expect(where.device.status.in).not.toContain('PENDING_INSTALL');
    expect(where.device.status.in).not.toContain('DEACTIVATED');
  });

  it('allowlist de testadores entra sem consultar nada', async () => {
    process.env.APP_ASSOCIATE_ALLOWLIST = '085.775.907-80';
    const prisma = prismaCom([], []);
    expect(await associadoPodeUsarApp(prisma, { id: 'a1', cpf: '08577590780' })).toBe(true);
    expect(prisma.vehicle.findMany).not.toHaveBeenCalled();
  });
});
