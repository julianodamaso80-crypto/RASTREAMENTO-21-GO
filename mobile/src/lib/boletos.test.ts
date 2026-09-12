import { estaVencido, tituloDoBoleto, valorEmReais } from './boletos';

describe('valorEmReais', () => {
  it('formata no padrao brasileiro', () => {
    expect(valorEmReais(250.57)).toBe('R$ 250,57');
  });
  it('milhar com ponto', () => {
    expect(valorEmReais(1250.5)).toBe('R$ 1.250,50');
  });
  it('sem valor mostra traco, nunca R$ 0,00', () => {
    expect(valorEmReais(null)).toBe('—');
  });
});

describe('estaVencido — decide a cor do cartao', () => {
  it('venceu ontem esta vencido', () => {
    expect(estaVencido('venceu ontem')).toBe(true);
  });
  it('venceu ha 3 dias esta vencido', () => {
    expect(estaVencido('venceu há 3 dias')).toBe(true);
  });
  it('vence hoje ainda NAO esta vencido', () => {
    expect(estaVencido('vence hoje')).toBe(false);
  });
  it('vence em 8 dias nao esta vencido', () => {
    expect(estaVencido('vence em 8 dias')).toBe(false);
  });
});

describe('tituloDoBoleto', () => {
  it('escreve o mes por extenso', () => {
    expect(tituloDoBoleto('09/2026')).toBe('Mensalidade de setembro');
  });
  it('sem mes usa titulo generico', () => {
    expect(tituloDoBoleto(null)).toBe('Mensalidade');
  });
});
