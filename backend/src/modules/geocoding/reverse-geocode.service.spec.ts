import {
  ReverseGeocodeService,
  distanciaMetros,
  formatarEndereco,
} from './reverse-geocode.service';

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

describe('cache por proximidade', () => {
  // O ponto que não está no cache entra na fila de fundo, e a fila chama o
  // Nominatim. Teste não fala com a internet.
  beforeEach(() => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('rede desligada no teste'));
  });
  afterEach(() => jest.restoreAllMocks());

  /** Prisma de mentira: devolve o que o teste plantou e registra a busca. */
  function prismaFake(linhas: Array<{ lat: number; lng: number; address: string }>) {
    return {
      geoAddress: {
        findMany: jest.fn().mockResolvedValue(
          linhas.map((l) => ({
            latKey: Math.round(l.lat * 1e4) / 1e4,
            lngKey: Math.round(l.lng * 1e4) / 1e4,
            lat: l.lat,
            lng: l.lng,
            address: l.address,
          })),
        ),
      },
    } as never;
  }

  it('reaproveita o endereço de um ponto a poucos metros (GPS parado oscilando)', async () => {
    const servico = new ReverseGeocodeService(
      prismaFake([
        { lat: -22.9058, lng: -43.1795, address: 'Rua Certa - Centro, Rio de Janeiro - RJ' },
      ]),
    );

    // ~11 m ao norte do ponto que gerou o endereço.
    const achados = await servico.lookupCached([
      { latitude: -22.9057, longitude: -43.1795 },
    ]);

    const chave = servico.chave({ latitude: -22.9057, longitude: -43.1795 })!;
    expect(achados.get(chave)).toBe('Rua Certa - Centro, Rio de Janeiro - RJ');
  });

  it('recusa o endereço de um ponto longe demais — é onde nascia a rua errada', async () => {
    const servico = new ReverseGeocodeService(
      prismaFake([
        { lat: -22.9058, lng: -43.1795, address: 'Rua de Trás - Centro, Rio de Janeiro - RJ' },
      ]),
    );

    // ~110 m: a distância que o cache antigo tratava como "mesmo lugar".
    const achados = await servico.lookupCached([
      { latitude: -22.9048, longitude: -43.1795 },
    ]);

    expect(achados.size).toBe(0);
  });
});

describe('distanciaMetros', () => {
  it('mede a diferença de uma casa decimal em latitude como ~11 m', () => {
    expect(distanciaMetros(-22.9058, -43.1795, -22.9057, -43.1795)).toBeCloseTo(11, 0);
  });

  it('mede três casas decimais como ~111 m', () => {
    expect(distanciaMetros(-22.9058, -43.1795, -22.9048, -43.1795)).toBeCloseTo(111, 0);
  });
});
