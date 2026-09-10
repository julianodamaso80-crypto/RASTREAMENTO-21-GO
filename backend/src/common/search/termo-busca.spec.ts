import { interpretarTermo, orDeCampos } from './termo-busca';

/**
 * O que estes testes protegem: uma busca que devolve a base inteira é pior que
 * uma busca que não acha nada — o operador acha que filtrou e lê a lista errada.
 * Ver [[reference_busca_contains_vazio]].
 */
describe('interpretarTermo', () => {
  it('devolve null para termo vazio ou só pontuação', () => {
    expect(interpretarTermo('')).toBeNull();
    expect(interpretarTermo('   ')).toBeNull();
    expect(interpretarTermo('...')).toBeNull();
    expect(interpretarTermo(undefined)).toBeNull();
  });

  it('separa texto, dígitos e alfanumérico', () => {
    const t = interpretarTermo(' rjq1b12 ')!;
    expect(t.texto).toBe('rjq1b12');
    expect(t.alfanumerico).toBe('RJQ1B12');
    expect(t.temLetra).toBe(true);
  });

  it('limpa a máscara de um CPF digitado com ponto e traço', () => {
    const t = interpretarTermo('123.456.789-01')!;
    expect(t.digitos).toBe('12345678901');
    expect(t.temLetra).toBe(false);
  });
});

describe('orDeCampos', () => {
  const campos = {
    texto: ['associate.name'],
    alfanumerico: ['plate', 'chassi'],
    documento: ['associate.cpf'],
    identificador: ['device.imei', 'chip.iccid'],
  };

  it('nunca gera contains vazio', () => {
    // "ana" não tem dígito: se o CPF entrasse como contains:"" casaria com
    // TODOS os associados e a busca por nome traria a base inteira.
    const or = orDeCampos(interpretarTermo('ana')!, campos);
    const json = JSON.stringify(or);
    expect(json).not.toContain('""');
    expect(json).not.toContain('cpf');
  });

  it('termo com letra não vira busca por dígitos', () => {
    // "sis1f13" viraria "113" e casaria com qualquer IMEI/CPF que contenha 113.
    const or = orDeCampos(interpretarTermo('sis1f13')!, campos);
    const json = JSON.stringify(or);
    expect(json).not.toContain('imei');
    expect(json).not.toContain('cpf');
    expect(json).toContain('SIS1F13');
  });

  it('documento só entra com dígitos suficientes', () => {
    // "232" é pedaço de placa, não documento.
    expect(JSON.stringify(orDeCampos(interpretarTermo('232')!, campos))).not.toContain('cpf');
    expect(JSON.stringify(orDeCampos(interpretarTermo('12345678901')!, campos))).toContain('cpf');
  });

  it('identificador (IMEI/ICCID) entra a partir de 4 dígitos', () => {
    expect(JSON.stringify(orDeCampos(interpretarTermo('123')!, campos))).not.toContain('imei');
    expect(JSON.stringify(orDeCampos(interpretarTermo('0854')!, campos))).toContain('imei');
  });

  it('monta caminho aninhado como o Prisma espera', () => {
    const or = orDeCampos(interpretarTermo('maria')!, campos);
    expect(or).toContainEqual({
      associate: { name: { contains: 'maria', mode: 'insensitive' } },
    });
  });

  it('devolve lista vazia quando nenhum campo pode casar', () => {
    // Só campos numéricos configurados e termo sem dígito: não há o que buscar,
    // e devolver [] deixa o chamador responder "nada encontrado" em vez de tudo.
    const or = orDeCampos(interpretarTermo('ana')!, { identificador: ['imei'] });
    expect(or).toEqual([]);
  });
});
