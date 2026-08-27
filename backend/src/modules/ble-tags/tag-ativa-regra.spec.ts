import { ehTagRastreavel, LinhaEspelhoTag } from './tag-ativa-regra';

const comPosicao: LinhaEspelhoTag = {
  identificador: 'RDV-1',
  modelo: 'REDETAG',
  latitude: -22.939,
  longitude: -43.56,
  seenAt: '2026-08-27T12:00:00.000Z',
  origem: 'REDEVEICULOS',
};

describe('ehTagRastreavel — a definição de "TAG ativa"', () => {
  /**
   * A regra é do dono, e é dura: só é TAG ativa quando sabemos QUEM é o
   * associado E ONDE a TAG está marcando. Faltando qualquer um dos dois, a
   * TAG não está ativa — está contratada, que é outra coisa.
   */

  it('é ativa quando tem espelho com posição', () => {
    expect(ehTagRastreavel(comPosicao)).toBe(true);
  });

  it('não é ativa sem nenhuma linha no espelho', () => {
    expect(ehTagRastreavel(null)).toBe(false);
  });

  it('não é ativa quando o espelho existe mas nunca viu a TAG', () => {
    expect(
      ehTagRastreavel({ ...comPosicao, latitude: null, longitude: null }),
    ).toBe(false);
  });

  it('não é ativa com meia coordenada', () => {
    expect(ehTagRastreavel({ ...comPosicao, longitude: null })).toBe(false);
    expect(ehTagRastreavel({ ...comPosicao, latitude: null })).toBe(false);
  });

  it('coordenada (0,0) não é posição — é o vazio da origem', () => {
    expect(ehTagRastreavel({ ...comPosicao, latitude: 0, longitude: 0 })).toBe(
      false,
    );
  });

  it('continua ativa mesmo com avistamento antigo', () => {
    // Posição de 6 meses atrás ainda é a última pista conhecida do veículo, e
    // é o que a recuperação usa. A tela mostra a idade; esconder a TAG seria
    // pior que mostrá-la velha.
    expect(
      ehTagRastreavel({ ...comPosicao, seenAt: '2026-01-02T00:00:00.000Z' }),
    ).toBe(true);
  });

  it('posição sem carimbo de data ainda conta como rastreável', () => {
    expect(ehTagRastreavel({ ...comPosicao, seenAt: null })).toBe(true);
  });
});
