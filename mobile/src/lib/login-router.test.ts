import { resolveLoginTarget } from './login-router';

describe('resolveLoginTarget', () => {
  it('CPF com máscara vai pro mundo do associado', () => {
    expect(resolveLoginTarget('085.775.907-80')).toBe('associate');
  });

  it('CPF só com dígitos vai pro mundo do associado', () => {
    expect(resolveLoginTarget('08577590780')).toBe('associate');
  });

  it('e-mail vai pro mundo interno', () => {
    expect(resolveLoginTarget('operador@trackgo.site')).toBe('internal');
  });

  it('espaços em volta não confundem', () => {
    expect(resolveLoginTarget('  operador@trackgo.site ')).toBe('internal');
  });

  it('CPF incompleto é inválido — não chega a bater na API', () => {
    expect(resolveLoginTarget('0857759')).toBe('invalid');
  });

  it('texto solto sem arroba é inválido', () => {
    expect(resolveLoginTarget('joao')).toBe('invalid');
  });

  it('vazio é inválido', () => {
    expect(resolveLoginTarget('')).toBe('invalid');
  });

  it('e-mail ganha do formato numérico se tiver arroba', () => {
    expect(resolveLoginTarget('08577590780@trackgo.site')).toBe('internal');
  });

  it('CNPJ com máscara vai pro mundo do associado (a base tem PJ)', () => {
    expect(resolveLoginTarget('49.410.571/0001-93')).toBe('associate');
  });

  it('CNPJ só com dígitos vai pro mundo do associado', () => {
    expect(resolveLoginTarget('49410571000193')).toBe('associate');
  });

  it('documento com 12 dígitos não é CPF nem CNPJ', () => {
    expect(resolveLoginTarget('491234567890')).toBe('invalid');
  });
});
