import {
  TELEFONE_SETOR_BOLETOS,
  aindaPodePagar,
  dentroDaJanelaDoSga,
  rotuloVencimento,
} from './boletos.regras';

const HOJE = new Date('2026-09-12T12:00:00-03:00');

describe('rotuloVencimento — a frase que o associado lê', () => {
  it('vence hoje', () => {
    expect(rotuloVencimento('2026-09-12', HOJE)).toBe('vence hoje');
  });
  it('vence amanha fala no singular', () => {
    expect(rotuloVencimento('2026-09-13', HOJE)).toBe('vence amanhã');
  });
  it('vence em 8 dias', () => {
    expect(rotuloVencimento('2026-09-20', HOJE)).toBe('vence em 8 dias');
  });
  it('venceu ontem fala no singular', () => {
    expect(rotuloVencimento('2026-09-11', HOJE)).toBe('venceu ontem');
  });
  it('venceu ha 3 dias', () => {
    expect(rotuloVencimento('2026-09-09', HOJE)).toBe('venceu há 3 dias');
  });
  it('sem vencimento nao inventa frase', () => {
    expect(rotuloVencimento(null, HOJE)).toBe('');
  });
});

describe('aindaPodePagar — 5 emite, 6 nao', () => {
  it('a vencer pode', () => {
    expect(aindaPodePagar('2026-09-20', HOJE)).toBe(true);
  });
  it('5 dias de atraso ainda pode', () => {
    expect(aindaPodePagar('2026-09-07', HOJE)).toBe(true);
  });
  it('6 dias de atraso nao pode', () => {
    expect(aindaPodePagar('2026-09-06', HOJE)).toBe(false);
  });
});

describe('dentroDaJanelaDoSga — medido em 12/09/2026', () => {
  it('sabado ao meio-dia esta FORA (10.341 recusas medidas)', () => {
    expect(dentroDaJanelaDoSga(new Date('2026-09-12T12:00:00-03:00'))).toBe(false);
  });
  it('segunda as 9h esta dentro', () => {
    expect(dentroDaJanelaDoSga(new Date('2026-09-14T09:00:00-03:00'))).toBe(true);
  });
  it('sexta as 20h esta fora', () => {
    expect(dentroDaJanelaDoSga(new Date('2026-09-11T20:00:00-03:00'))).toBe(false);
  });
  it('domingo esta fora', () => {
    expect(dentroDaJanelaDoSga(new Date('2026-09-13T10:00:00-03:00'))).toBe(false);
  });
});

describe('texto do Setor de Boletos', () => {
  it('e exatamente o que o dono escreveu', () => {
    expect(TELEFONE_SETOR_BOLETOS.titulo).toBe(
      'Para dúvidas e informações, fale com nosso Setor de Boletos:',
    );
    expect(TELEFONE_SETOR_BOLETOS.telefones).toBe('📞 (21) 95933-5359 | (21) 98142-2100');
  });
});
