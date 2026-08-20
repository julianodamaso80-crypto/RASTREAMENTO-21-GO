/**
 * Login do app aceita o documento do associado — CPF (11) ou CNPJ (14).
 *
 * Associado pessoa jurídica existe e tem rastreador instalado; enquanto a
 * regra de "senha = documento" assumia 11 dígitos, ele levava o mesmo 401 de
 * senha errada e não entrava no app de jeito nenhum.
 */
import { normalizeDoc, docVariants, senhaEhODocumento } from './documento';

describe('documento do associado no login', () => {
  it('normaliza CPF e CNPJ tirando a máscara', () => {
    expect(normalizeDoc('083.293.907-21')).toBe('08329390721');
    expect(normalizeDoc('49.410.571/0001-93')).toBe('49410571000193');
  });

  it('gera as duas formas do CPF pra busca (o SGA grava dos dois jeitos)', () => {
    expect(docVariants('08329390721')).toEqual([
      '08329390721',
      '083.293.907-21',
    ]);
  });

  it('gera as duas formas do CNPJ pra busca', () => {
    expect(docVariants('49410571000193')).toEqual([
      '49410571000193',
      '49.410.571/0001-93',
    ]);
  });

  it('CPF vale como senha no primeiro acesso, com ou sem máscara', () => {
    expect(senhaEhODocumento('08329390721', '08329390721')).toBe(true);
    expect(senhaEhODocumento('08329390721', '083.293.907-21')).toBe(true);
  });

  it('CNPJ vale como senha no primeiro acesso, com ou sem máscara', () => {
    expect(senhaEhODocumento('49410571000193', '49410571000193')).toBe(true);
    expect(senhaEhODocumento('49410571000193', '49.410.571/0001-93')).toBe(true);
  });

  it('senha diferente do documento não passa', () => {
    expect(senhaEhODocumento('08329390721', '123456')).toBe(false);
    expect(senhaEhODocumento('49410571000193', '123456')).toBe(false);
  });

  it('documento com tamanho fora do padrão nunca vale como senha', () => {
    // Sem isso, cadastro com documento truncado viraria senha curta adivinhável.
    expect(senhaEhODocumento('123', '123')).toBe(false);
    expect(senhaEhODocumento('', '')).toBe(false);
  });
});
