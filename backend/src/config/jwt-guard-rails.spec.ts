import { assertJwtGuardRails } from './jwt-guard-rails';

const prodBase = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(32),
  JWT_ASSOCIATE_SECRET: 'b'.repeat(32),
};

describe('assertJwtGuardRails', () => {
  it('aceita produção com dois segredos fortes e distintos', () => {
    expect(() => assertJwtGuardRails(prodBase as any)).not.toThrow();
  });

  it('recusa segredos iguais — seria isolamento de mentira', () => {
    expect(() =>
      assertJwtGuardRails({
        ...prodBase,
        JWT_ASSOCIATE_SECRET: prodBase.JWT_SECRET,
      } as any),
    ).toThrow(/precisam ser diferentes/i);
  });

  it('recusa JWT_ASSOCIATE_SECRET ausente em produção', () => {
    expect(() =>
      assertJwtGuardRails({
        NODE_ENV: 'production',
        JWT_SECRET: 'a'.repeat(32),
      } as any),
    ).toThrow(/JWT_ASSOCIATE_SECRET/);
  });

  it('recusa segredo curto em produção', () => {
    expect(() =>
      assertJwtGuardRails({ ...prodBase, JWT_SECRET: 'curto' } as any),
    ).toThrow(/32 caracteres/);
  });

  it('fora de produção tolera ausência, mas ainda exige que os defaults difiram', () => {
    expect(() => assertJwtGuardRails({ NODE_ENV: 'development' } as any)).not.toThrow();
  });

  it('recusa iguais mesmo fora de produção', () => {
    expect(() =>
      assertJwtGuardRails({
        NODE_ENV: 'development',
        JWT_SECRET: 'x',
        JWT_ASSOCIATE_SECRET: 'x',
      } as any),
    ).toThrow(/precisam ser diferentes/i);
  });
});
