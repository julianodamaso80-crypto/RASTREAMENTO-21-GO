import { estadoDaLista, estaVencido, RODAPE_SETOR_BOLETOS, tituloDoBoleto, valorEmReais } from './boletos';

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
  it('escreve o mes por extenso — formato MM/YYYY', () => {
    expect(tituloDoBoleto('09/2026')).toBe('Mensalidade de setembro');
  });

  // Achado I2: mesReferente do CRM vem YYYY-MM (ex.: "2026-09"), nao MM/YYYY.
  it('escreve o mes por extenso — formato YYYY-MM', () => {
    expect(tituloDoBoleto('2026-09')).toBe('Mensalidade de setembro');
  });

  it('sem mes usa titulo generico', () => {
    expect(tituloDoBoleto(null)).toBe('Mensalidade');
  });

  it('string vazia usa titulo generico', () => {
    expect(tituloDoBoleto('')).toBe('Mensalidade');
  });

  it('mes invalido (13) usa titulo generico, nao mes[NaN]', () => {
    expect(tituloDoBoleto('13/2026')).toBe('Mensalidade');
  });

  it('lixo qualquer usa titulo generico', () => {
    expect(tituloDoBoleto('lixo')).toBe('Mensalidade');
  });
});

describe('RODAPE_SETOR_BOLETOS — achado M2', () => {
  it('tem o mesmo texto do backend, pra sobreviver quando a consulta falha', () => {
    expect(RODAPE_SETOR_BOLETOS.telefones).toBe('📞 (21) 95933-5359 | (21) 98142-2100');
    expect(RODAPE_SETOR_BOLETOS.titulo).toBe(
      'Para dúvidas e informações, fale com nosso Setor de Boletos:',
    );
  });
});

describe('estadoDaLista — achado C3, decide a mensagem quando nao ha boleto', () => {
  it('falha na consulta manda pro estado de falha, mesmo com foraDoPrazo > 0', () => {
    expect(estadoDaLista({ comFalha: true, pendente: false, foraDoPrazo: 3 })).toBe('falha');
  });

  it('nunca visitado manda pro estado pendente, mesmo com foraDoPrazo > 0', () => {
    expect(estadoDaLista({ comFalha: false, pendente: true, foraDoPrazo: 3 })).toBe('pendente');
  });

  it('visitado, sem boleto, mas com pendencia velha: NAO pode dizer "em dia"', () => {
    expect(estadoDaLista({ comFalha: false, pendente: false, foraDoPrazo: 1 })).toBe('foraDoPrazo');
  });

  it('visitado, sem boleto, sem pendencia: em dia de verdade', () => {
    expect(estadoDaLista({ comFalha: false, pendente: false, foraDoPrazo: 0 })).toBe('emDia');
  });
});
