import {
  LIMITE_POR_USUARIO,
  limiteDaRequisicao,
  rastreadorDaRequisicao,
} from './tenant-throttler.guard';

/**
 * 16/09/2026, 14h00–14h03: o Estoque abriu "Erro ao carregar estoque" para o
 * escritório inteiro. Access log do Traefik: 32 respostas 429 em /api/v1/stock.
 * A cota de 100/min era da EMPRESA — cada aba do painel já consome ~15/min só
 * com o mapa (positions + devices a cada 8 s), e o escritório chegou a 305/min.
 */
describe('TenantThrottlerGuard — de quem é a cota', () => {
  it('usuário logado tem cota própria, não dividida com a empresa', () => {
    const a = { user: { id: 'u1' }, tenantId: 't1', ip: '187.62.241.174' };
    const b = { user: { id: 'u2' }, tenantId: 't1', ip: '187.62.241.174' };
    expect(rastreadorDaRequisicao(a)).toBe('user:u1');
    expect(rastreadorDaRequisicao(b)).toBe('user:u2');
  });

  it('sem usuário, mas com tenant, cai no tenant', () => {
    expect(rastreadorDaRequisicao({ tenantId: 't1', ip: '1.2.3.4' })).toBe('tenant:t1');
  });

  it('rota pública (login) segue contada por IP', () => {
    expect(rastreadorDaRequisicao({ ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
    expect(rastreadorDaRequisicao({ headers: { 'x-forwarded-for': ['9.9.9.9'] } })).toBe('ip:9.9.9.9');
  });

  it('usuário logado recebe o limite por usuário; o resto mantém o padrão', () => {
    expect(limiteDaRequisicao({ user: { id: 'u1' } }, 100)).toBe(LIMITE_POR_USUARIO);
    expect(limiteDaRequisicao({ ip: '1.2.3.4' }, 100)).toBe(100);
    expect(LIMITE_POR_USUARIO).toBeGreaterThanOrEqual(300);
  });
});
