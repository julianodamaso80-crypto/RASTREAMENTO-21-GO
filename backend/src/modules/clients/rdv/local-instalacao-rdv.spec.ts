import { lerLocaisRdv, montarSqlLocais } from './local-instalacao-rdv';

const cab = (...n: string[]) => n.map((text) => ({ text }));
const CABECALHO = cab(
  'Placa',
  'Local da instalação do equipamento',
  'Imei',
  'Identificador',
  'Modelo rastreador',
);

describe('lerLocaisRdv — relatório de Ativos da plataforma de origem', () => {
  it('lê o local pelo cabeçalho, tira os zeros do IMEI e separa TAG de rastreador', () => {
    const locais = lerLocaisRdv([
      CABECALHO,
      cab('KQQ8J29', 'Embaixo Do Tanque', '000000511345880', '511345880', 'ST340'),
      cab('TCY9B82', 'Dentro Do Banco', '808092605072181', '808092605072181', 'KTAG'),
    ]);
    expect(locais).toEqual([
      {
        placa: 'KQQ8J29',
        local: 'Embaixo Do Tanque',
        imei: '511345880',
        identificador: '511345880',
        modelo: 'ST340',
        tag: false,
      },
      {
        placa: 'TCY9B82',
        local: 'Dentro Do Banco',
        imei: '808092605072181',
        identificador: '808092605072181',
        modelo: 'KTAG',
        tag: true,
      },
    ]);
  });

  it('"Não informado" e vazio não viram local', () => {
    const locais = lerLocaisRdv([
      CABECALHO,
      cab('AAA1A11', 'Não informado', '1', '1', 'J16'),
      cab('BBB2B22', '', '2', '2', 'J16'),
      cab('CCC3C33', '  ', '3', '3', 'J16'),
    ]);
    expect(locais).toEqual([]);
  });

  it('"Zero KM" na placa é placa nenhuma', () => {
    const [l] = lerLocaisRdv([CABECALHO, cab('Zero KM', 'Rabeta', '4', '4', 'J16')]);
    expect(l.placa).toBeNull();
  });

  it('recusa planilha sem a coluna do local', () => {
    expect(() => lerLocaisRdv([cab('Placa', 'Imei')])).toThrow(/Local da instalação/);
  });
});

describe('montarSqlLocais — só preenche o que está vazio', () => {
  const TENANT = '11111111-1111-1111-1111-111111111111';

  it('rastreador casa por IMEI em devices, TAG por série em tag_links, sem sobrescrever', () => {
    const sql = montarSqlLocais(
      lerLocaisRdv([
        CABECALHO,
        cab('KQQ8J29', "Atrás d'a Bateria", '000000511345880', '511345880', 'ST340'),
        cab('TCY9B82', 'Dentro Do Banco', '808092605072181', '808092605072181', 'KTAG'),
      ]),
      TENANT,
    );
    expect(sql).toContain(
      `UPDATE devices SET install_location = 'Atrás d''a Bateria' WHERE tenant_id = '${TENANT}'::uuid AND ltrim(imei, '0') = '511345880'`,
    );
    expect(sql).toContain(
      `UPDATE tag_links SET install_location = 'Dentro Do Banco' WHERE tenant_id = '${TENANT}'::uuid AND serial_number = '808092605072181'`,
    );
    // Cada UPDATE respeita o que já está preenchido.
    const updates = sql.split('\n').filter((l) => l.startsWith('UPDATE'));
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      expect(u).toContain("(install_location IS NULL OR btrim(install_location) = '')");
      expect(u).toContain('deleted_at IS NULL');
    }
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('não casa por placa: sem número do equipamento a linha é ignorada', () => {
    const sql = montarSqlLocais(
      [{ placa: 'AAA1A11', local: 'Farol', imei: null, identificador: null, modelo: 'J16', tag: false }],
      TENANT,
    );
    expect(sql).not.toContain('UPDATE');
  });
});
