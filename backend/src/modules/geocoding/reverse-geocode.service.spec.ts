import { formatarEndereco } from './reverse-geocode.service';

describe('formatarEndereco', () => {
  it('monta rua - bairro, cidade - UF (mesmo formato da referência)', () => {
    expect(
      formatarEndereco({
        address: {
          road: 'Rua Jorge Sampaio',
          suburb: 'Campo Grande',
          city: 'Rio de Janeiro',
          state: 'Rio de Janeiro',
          'ISO3166-2-lvl4': 'BR-RJ',
        },
      }),
    ).toBe('Rua Jorge Sampaio - Campo Grande, Rio de Janeiro - RJ');
  });

  it('não deixa hífen solto quando falta o bairro', () => {
    expect(
      formatarEndereco({
        address: {
          road: 'Estrada do Magarça',
          city: 'Rio de Janeiro',
          'ISO3166-2-lvl4': 'BR-RJ',
        },
      }),
    ).toBe('Estrada do Magarça, Rio de Janeiro - RJ');
  });

  it('usa o estado por extenso quando o ISO não vem', () => {
    expect(
      formatarEndereco({
        address: {
          road: 'Rua Almir Freire',
          suburb: 'Bom Jesus',
          town: 'Bom Jesus',
          state: 'Rio Grande do Norte',
        },
      }),
    ).toBe('Rua Almir Freire - Bom Jesus, Bom Jesus - Rio Grande do Norte');
  });

  it('cai pro display_name quando não dá pra montar nada', () => {
    expect(
      formatarEndereco({
        display_name: 'Zona rural, Brasil',
        address: {},
      }),
    ).toBe('Zona rural, Brasil');
  });

  it('devolve null quando o Nominatim não achou nada', () => {
    expect(formatarEndereco({})).toBeNull();
  });
});
