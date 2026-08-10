import { UnauthorizedException } from '@nestjs/common';
import { AssociateJwtGuard } from './associate-jwt.guard';

function ctx(token?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    }),
  } as any;
}

function build(payload: any) {
  const jwt = { verify: jest.fn(() => payload) };
  const config = { get: () => 'b'.repeat(32) };
  const prisma = {
    associate: {
      findFirst: jest.fn().mockResolvedValue({ id: 'a1', tenantId: 't1' }),
    },
  };
  return new AssociateJwtGuard(jwt as any, config as any, prisma as any);
}

describe('AssociateJwtGuard', () => {
  it('recusa token do painel', async () => {
    const guard = build({ sub: 'u1', type: 'user' });
    await expect(guard.canActivate(ctx('x'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('recusa token sem type', async () => {
    const guard = build({ sub: 'a1' });
    await expect(guard.canActivate(ctx('x'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('aceita token de associado', async () => {
    const guard = build({ sub: 'a1', type: 'associate', tenantId: 't1' });
    await expect(guard.canActivate(ctx('x'))).resolves.toBe(true);
  });

  it('recusa requisição sem header', async () => {
    const guard = build({ sub: 'a1', type: 'associate' });
    await expect(guard.canActivate(ctx())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('verifica o token com o segredo do mundo do associado, não com o do painel', async () => {
    const payload = { sub: 'a1', type: 'associate', tenantId: 't1' };
    // Assinatura explícita: sem ela o TypeScript infere uma tupla vazia em
    // mock.calls e a leitura das opções abaixo não compila.
    const jwt = {
      verify: jest.fn((_token: string, _options: { secret: string }) => payload),
    };
    // Mock que devolve o próprio nome da chave, não um valor genérico
    const config = { get: jest.fn((key: string) => key) };
    const prisma = {
      associate: {
        findFirst: jest.fn().mockResolvedValue({ id: 'a1', tenantId: 't1' }),
      },
    };

    const guard = new AssociateJwtGuard(jwt as any, config as any, prisma as any);
    await guard.canActivate(ctx('x'));

    // Valida que config.get foi consultado com a chave correta
    expect(config.get).toHaveBeenCalledWith('jwt.associateSecret');

    // Valida que jwt.verify recebeu o segredo do associado
    const [, options] = jwt.verify.mock.calls[0];
    expect(options.secret).toBe('jwt.associateSecret');
  });
});
