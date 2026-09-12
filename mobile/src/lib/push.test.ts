import { rotaDoAviso } from './push';

describe('rotaDoAviso — para onde o toque leva', () => {
  it('aviso de boleto abre a aba de boletos', () => {
    expect(rotaDoAviso({ rota: '/boletos' })).toBe('/boletos');
  });
  it('payload sem rota nao navega', () => {
    expect(rotaDoAviso({})).toBeNull();
  });
  it('rota estranha e ignorada — push nao manda o app pra qualquer lugar', () => {
    expect(rotaDoAviso({ rota: 'https://site-suspeito.test' })).toBeNull();
  });
  it('lixo nao quebra', () => {
    expect(rotaDoAviso(null)).toBeNull();
  });
});
