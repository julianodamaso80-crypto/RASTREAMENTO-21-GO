import { variantesTelefone } from './telefone';

describe('variantesTelefone', () => {
  it('aceita o número com máscara e devolve com e sem o 55', () => {
    expect(variantesTelefone('(21) 99834-5046').sort()).toEqual(
      ['21998345046', '5521998345046', '2198345046', '552198345046'].sort(),
    );
  });

  it('aceita o número já com o 55', () => {
    expect(variantesTelefone('+55 21 99834-5046').sort()).toEqual(
      ['21998345046', '5521998345046', '2198345046', '552198345046'].sort(),
    );
  });

  it('aceita fixo de 10 dígitos', () => {
    expect(variantesTelefone('21 3333-4444').sort()).toEqual(
      ['2133334444', '552133334444'].sort(),
    );
  });

  it('recusa número curto ou longo demais', () => {
    expect(variantesTelefone('99834-5046')).toEqual([]);
    expect(variantesTelefone('123')).toEqual([]);
    expect(variantesTelefone('')).toEqual([]);
    expect(variantesTelefone('5521998345046999')).toEqual([]);
  });

  it('celular gravado sem o nono dígito é achado por quem digita com ele', () => {
    expect(variantesTelefone('21 99834-5046')).toContain('2198345046');
  });

  it('celular digitado sem o nono dígito acha o cadastro que tem', () => {
    expect(variantesTelefone('21 9834-5046')).toContain('21998345046');
  });

  it('não confunde celular com o fixo que sobraria ao tirar o 9', () => {
    expect(variantesTelefone('21 92222-3333').sort()).toEqual(
      ['21922223333', '5521922223333'].sort(),
    );
  });
});
