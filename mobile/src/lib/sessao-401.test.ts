import { deveDeslogarPor401 } from './sessao-401';

describe('deveDeslogarPor401', () => {
  it('senha atual errada na troca de senha NÃO derruba a sessão', () => {
    expect(deveDeslogarPor401('/app/auth/change-password')).toBe(false);
    expect(deveDeslogarPor401('https://api.trackgo.site/api/v1/app/auth/change-password')).toBe(false);
  });

  it('credencial recusada no login, no esqueci e no código também não', () => {
    expect(deveDeslogarPor401('/app/auth/login')).toBe(false);
    expect(deveDeslogarPor401('/app/auth/forgot-password')).toBe(false);
    expect(deveDeslogarPor401('/app/auth/reset-password')).toBe(false);
  });

  it('token expirado numa rota protegida continua deslogando', () => {
    expect(deveDeslogarPor401('/app/vehicles')).toBe(true);
    expect(deveDeslogarPor401('/app/alerts?page=1')).toBe(true);
    expect(deveDeslogarPor401('/app/boletos/dispositivo')).toBe(true);
    expect(deveDeslogarPor401(undefined)).toBe(true);
  });
});
