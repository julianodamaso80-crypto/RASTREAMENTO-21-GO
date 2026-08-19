import {
  ReverseGeocodeService,
  distanciaMetros,
  formatarEndereco,
  proximoSlot,
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

    // ~4 m ao norte do ponto que gerou o endereço: dentro da tolerância.
    const achados = await servico.lookupCached([
      { latitude: -22.90576, longitude: -43.1795 },
    ]);

    const chave = servico.chave({ latitude: -22.90576, longitude: -43.1795 })!;
    expect(achados.get(chave)).toBe('Rua Certa - Centro, Rio de Janeiro - RJ');
  });

  it('recusa o vizinho a 17 m — o caso real do TTW5I01 em 19/08', async () => {
    // Medido em produção: o ponto do veículo (-22.88186, -43.42077) é Rua
    // Piraquara; a 17,2 m dali o Nominatim responde Rua Cristóvão de Barros,
    // e era esse o endereço que a tela mostrava. Varrendo 5/10/15/20/25 m em
    // torno de três veículos reais, nenhum caso mudou de rua a 5 m e a maioria
    // mudou a partir de 15 m — por isso a tolerância é 5, não 25.
    const servico = new ReverseGeocodeService(
      prismaFake([
        {
          lat: -22.882002222222223,
          lng: -43.42070277777778,
          address: 'Rua Cristóvão de Barros - Realengo, Rio de Janeiro - RJ',
        },
      ]),
    );

    const achados = await servico.lookupCached([
      { latitude: -22.88186, longitude: -43.42077 },
    ]);

    expect(achados.size).toBe(0);
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

describe('tolerância zero — o painel do veículo', () => {
  it('recusa até o vizinho a 4 m quando a tolerância pedida é zero', async () => {
    const prisma = {
      geoAddress: {
        findMany: jest.fn().mockResolvedValue([
          {
            latKey: -22.9058,
            lngKey: -43.1795,
            lat: -22.9058,
            lng: -43.1795,
            address: 'Rua Vizinha - Centro, Rio de Janeiro - RJ',
          },
        ]),
      },
    } as never;
    const servico = new ReverseGeocodeService(prisma);

    // ~4 m: aceito no lote do estoque, recusado quando se pede exatidão.
    const pedido = { latitude: -22.90576, longitude: -43.1795 };
    const comTolerancia = await servico.lookupCached([pedido]);
    const semTolerancia = await servico.lookupCached([pedido], 0);

    expect(comTolerancia.size).toBe(1);
    expect(semTolerancia.size).toBe(0);
  });
});

describe('proximoSlot — portão de 1 chamada por vez ao Nominatim', () => {
  it('primeira chamada não espera', () => {
    expect(proximoSlot(1_000, 0, 1_100)).toEqual({
      esperaMs: 0,
      novoSlotLivreEm: 2_100,
    });
  });

  it('chamada imediatamente depois espera o intervalo cheio', () => {
    expect(proximoSlot(1_000, 2_100, 1_100)).toEqual({
      esperaMs: 1_100,
      novoSlotLivreEm: 3_200,
    });
  });

  it('slot vencido não gera espera nem acumula atraso', () => {
    expect(proximoSlot(9_000, 2_100, 1_100)).toEqual({
      esperaMs: 0,
      novoSlotLivreEm: 10_100,
    });
  });
});

describe('enfileirarFaltantes — freio da geocodificação em massa', () => {
  it('não põe nada na fila quando o chamador pede só leitura de cache', async () => {
    const prisma = {
      geoAddress: { findMany: jest.fn().mockResolvedValue([]) },
    } as never;
    const servico = new ReverseGeocodeService(prisma);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('rede desligada no teste'));

    await servico.lookupCached(
      [{ latitude: -22.9058, longitude: -43.1795 }],
      undefined,
      false,
    );
    // A fila roda fora do await; dar uma volta no event loop é suficiente pra
    // provar que ninguém saiu chamando o Nominatim.
    await new Promise((r) => setImmediate(r));

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
