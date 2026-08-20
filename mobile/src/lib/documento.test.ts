import { maskDocumento } from './format';

describe('maskDocumento', () => {
  it('mascara CPF conforme digita', () => {
    expect(maskDocumento('08329390721')).toBe('083.293.907-21');
  });

  it('mascara CNPJ conforme digita', () => {
    expect(maskDocumento('49410571000193')).toBe('49.410.571/0001-93');
  });

  it('não estraga o que ainda está incompleto', () => {
    expect(maskDocumento('0832')).toBe('083.2');
  });

  it('para de aceitar dígito depois do CNPJ completo', () => {
    expect(maskDocumento('494105710001939999')).toBe('49.410.571/0001-93');
  });
});
