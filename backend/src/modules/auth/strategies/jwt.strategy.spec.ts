import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

function build(requireType: boolean, user: any) {
  const config = {
    get: (key: string) =>
      key === 'jwt.secret' ? 'a'.repeat(32) : requireType,
  } as unknown as ConfigService;
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
  return new JwtStrategy(config, prisma as any);
}

const ativo = {
  id: 'u1',
  email: 'op@trackgo.site',
  name: 'Operador',
  role: 'OPERATOR',
  tenantId: 't1',
  active: true,
  allowedRoutes: ['mapa'],
};

describe('JwtStrategy', () => {
  it('recusa token de associado mesmo que o sub exista como usuário', async () => {
    const strategy = build(false, ativo);
    await expect(
      strategy.validate({ sub: 'u1', type: 'associate' } as any),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('aceita token do painel com type user', async () => {
    const strategy = build(false, ativo);
    await expect(
      strategy.validate({ sub: 'u1', type: 'user' } as any),
    ).resolves.toMatchObject({ id: 'u1' });
  });

  it('tolera token legado sem type enquanto requireType está desligado', async () => {
    const strategy = build(false, ativo);
    await expect(strategy.validate({ sub: 'u1' } as any)).resolves.toMatchObject({
      id: 'u1',
    });
  });

  it('recusa token legado sem type depois que requireType é ligado', async () => {
    const strategy = build(true, ativo);
    await expect(strategy.validate({ sub: 'u1' } as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('recusa usuário inativo', async () => {
    const strategy = build(false, { ...ativo, active: false });
    await expect(
      strategy.validate({ sub: 'u1', type: 'user' } as any),
    ).rejects.toThrow(UnauthorizedException);
  });
});
