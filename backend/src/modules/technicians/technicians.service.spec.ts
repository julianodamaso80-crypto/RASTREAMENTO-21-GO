import { normalizeCpf, generateTempPassword } from './technicians.service';

describe('normalizeCpf', () => {
  it('remove máscara e deixa só dígitos', () => {
    expect(normalizeCpf('137.915.777-35')).toBe('13791577735');
  });

  it('trata string vazia sem quebrar', () => {
    expect(normalizeCpf('')).toBe('');
  });
});

describe('generateTempPassword', () => {
  it('gera 8 caracteres', () => {
    expect(generateTempPassword()).toHaveLength(8);
  });

  it('nunca usa caracteres ambíguos (0, O, 1, I, L)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateTempPassword()).not.toMatch(/[0O1IL]/);
    }
  });

  it('não repete a mesma senha em sequência', () => {
    const senhas = new Set(
      Array.from({ length: 50 }, () => generateTempPassword()),
    );
    expect(senhas.size).toBeGreaterThan(45);
  });
});
