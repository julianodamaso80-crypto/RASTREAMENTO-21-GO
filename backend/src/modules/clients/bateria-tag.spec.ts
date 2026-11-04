import { nivelBateria } from './bateria-tag';

describe('nivelBateria (bits 6-7 do status Find My)', () => {
  it('lê os valores crus vistos na coleta da 21 GO', () => {
    expect(nivelBateria(32)).toBe('CHEIA');
    expect(nivelBateria(96)).toBe('MEDIA');
    expect(nivelBateria(160)).toBe('BAIXA');
    expect(nivelBateria(224)).toBe('CRITICA');
  });

  it('sem byte ou byte inválido é desconhecido', () => {
    expect(nivelBateria(null)).toBeNull();
    expect(nivelBateria(undefined)).toBeNull();
    expect(nivelBateria(-1)).toBeNull();
    expect(nivelBateria(256)).toBeNull();
  });
});
