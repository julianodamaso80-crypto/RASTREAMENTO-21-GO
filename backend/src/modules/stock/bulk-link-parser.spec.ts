import { linhasDaTabela, agruparItensEmLinhas } from './bulk-link-parser';

describe('linhasDaTabela', () => {
  const cab = ['Placa', 'IMEI', 'Nome Técnico', 'Local de Instalação'];

  it('lê as quatro colunas pelo cabeçalho, em qualquer ordem e com acento', () => {
    const r = linhasDaTabela([
      ['Local da instalação', 'IMEI', 'Placa do veículo', 'Técnico'],
      ['Painel', '865190072049441', 'abc-1d23', 'João'],
    ]);
    expect(r.erroGeral).toBeUndefined();
    expect(r.linhas).toEqual([
      {
        linha: 2,
        placa: 'ABC1D23',
        imei: '865190072049441',
        tecnico: 'João',
        local: 'Painel',
      },
    ]);
  });

  it('ignora o que vem antes do cabeçalho e linhas vazias', () => {
    const r = linhasDaTabela([
      ['RASTREADORES INSTALADOS 13.10'],
      [],
      cab,
      ['', '', '', ''],
      ['ABC1D23', '865190072049441', 'João', 'Painel'],
    ]);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].linha).toBe(5);
  });

  it('aponta cada campo obrigatório que faltou, na própria linha', () => {
    const r = linhasDaTabela([cab, ['ABC1D23', '865190072049441', '', '']]);
    expect(r.linhas[0].erro).toBe('Faltou: técnico, local de instalação');
  });

  it('pula o cabeçalho repetido em cada página do PDF', () => {
    const r = linhasDaTabela([
      cab,
      ['ABC1D23', '865190072049441', 'J', 'L'],
      cab,
      ['XYZ9K88', '865190072049442', 'J', 'L'],
    ]);
    expect(r.linhas.map((l) => l.erro)).toEqual([undefined, undefined]);
  });

  it('recusa IMEI que não tem 15 dígitos e avisa do Excel em notação científica', () => {
    const curto = linhasDaTabela([cab, ['ABC1D23', '12345', 'J', 'L']]);
    expect(curto.linhas[0].erro).toMatch(/IMEI inválido/);
    expect(curto.linhas[0].erro).toMatch(/15 dígitos.*TAG/);
    const sci = linhasDaTabela([cab, ['ABC1D23', '8,65E+14', 'J', 'L']]);
    expect(sci.linhas[0].erro).toMatch(/notação científica/);
  });

  it('aceita ID de TAG de 11 e de 10 dígitos (a TAG não tem IMEI de 15)', () => {
    const r = linhasDaTabela([
      cab,
      ['TUC4I38', '92603018558', 'CAIO', 'Próximo da buzina'],
      ['SRY7E50', '9260301990', 'CAIO', 'Embaixo do banco'],
    ]);
    expect(r.linhas.map((l) => l.erro)).toEqual([undefined, undefined]);
    expect(r.linhas[0].imei).toBe('92603018558');
  });

  it('continua recusando tamanhos que não são de IMEI nem de TAG (12 a 14 e 9 ou menos)', () => {
    const r = linhasDaTabela([
      cab,
      ['ABC1D23', '926030185581', 'J', 'L'],
      ['ABC1D24', '9260301855812', 'J', 'L'],
      ['ABC1D25', '92603018581234', 'J', 'L'],
      ['ABC1D26', '926030185', 'J', 'L'],
    ]);
    expect(r.linhas.every((l) => /IMEI inválido/.test(l.erro ?? ''))).toBe(true);
  });

  it('recusa placa que não tem 7 caracteres', () => {
    const r = linhasDaTabela([cab, ['AB12', '865190072049441', 'J', 'L']]);
    expect(r.linhas[0].erro).toMatch(/Placa inválida/);
  });

  it('aceita chassi de 17 caracteres no lugar da placa (moto nova)', () => {
    const r = linhasDaTabela([
      cab,
      ['9C2KC2500TR163224', '865190072049441', 'J', 'L'],
    ]);
    expect(r.linhas[0].erro).toBeUndefined();
    expect(r.linhas[0].placa).toBe('9C2KC2500TR163224');
  });

  it('marca a segunda ocorrência do mesmo IMEI no arquivo', () => {
    const r = linhasDaTabela([
      cab,
      ['ABC1D23', '865190072049441', 'J', 'L'],
      ['XYZ9K88', '865190072049441', 'J', 'L'],
    ]);
    expect(r.linhas[0].erro).toBeUndefined();
    expect(r.linhas[1].erro).toMatch(/repetido.*linha 2/);
  });

  it('diz quais colunas faltam quando não há cabeçalho reconhecível', () => {
    const r = linhasDaTabela([['ABC1D23', '865190072049441']]);
    expect(r.linhas).toEqual([]);
    expect(r.erroGeral).toMatch(/PLACA, IMEI, TÉCNICO e LOCAL/);
  });
});

describe('agruparItensEmLinhas (PDF)', () => {
  it('junta itens na mesma altura e separa células por espaço largo', () => {
    const item = (str: string, x: number, y: number, w: number) => ({
      str,
      x,
      y,
      width: w,
    });
    const linhas = agruparItensEmLinhas([
      item('Placa', 10, 700, 25),
      item('IMEI', 100, 700, 20),
      item('ABC1D23', 10, 680, 35),
      item('865190072049441', 100, 680, 75),
      item('Av.', 200, 680, 12),
      item('Brasil', 214, 680, 28),
    ]);
    expect(linhas).toEqual([
      ['Placa', 'IMEI'],
      ['ABC1D23', '865190072049441', 'Av. Brasil'],
    ]);
  });
});
