import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  ReverseGeocodeService,
  distanciaMetros,
  formatarEndereco,
  proximoSlot,
} from './reverse-geocode.service';

/** Prisma de mentira mínimo — sem linha nenhuma de cache, upsert vira no-op. */
function prismaFakeVazio() {
  return {
    geoAddress: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
  } as never;
}

/** ConfigService de mentira — só o `.get(chave)` que o serviço usa. */
function configFake(valores: Record<string, string | undefined>): ConfigService {
  return { get: (chave: string) => valores[chave] } as unknown as ConfigService;
}

function respostaOk(address: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ address }),
  } as never;
}

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

  it('acha a sigla pelo nome do estado quando o ISO não vem (geocoder próprio não emite ISO3166-2-lvl4)', () => {
    expect(
      formatarEndereco({
        address: {
          road: 'Rua Almir Freire',
          suburb: 'Bom Jesus',
          town: 'Bom Jesus',
          state: 'Rio Grande do Norte',
        },
      }),
    ).toBe('Rua Almir Freire - Bom Jesus, Bom Jesus - RN');
  });

  it('acha a sigla ignorando acento e caixa (grafia do OSM varia)', () => {
    expect(
      formatarEndereco({
        address: { city: 'Teresina', state: 'piaui' },
      }),
    ).toBe('Teresina - PI');
  });

  it('acha a sigla com o nome do estado JÁ acentuado (não só a versão sem acento)', () => {
    // O teste acima só alimenta 'piaui' (sem acento) — passaria mesmo se
    // SEM_DIACRITICOS parasse de casar qualquer coisa. Este aqui exige que o
    // regex realmente remova as marcas combinantes de 'São Paulo'/'Espírito
    // Santo', pegando a regressão que um re-encoding do arquivo introduziria.
    expect(
      formatarEndereco({ address: { city: 'Campinas', state: 'São Paulo' } }),
    ).toBe('Campinas - SP');
    expect(
      formatarEndereco({ address: { city: 'Vitória', state: 'Espírito Santo' } }),
    ).toBe('Vitória - ES');
  });

  it('devolve o nome por extenso quando não acha o estado no mapa nem no ISO', () => {
    expect(
      formatarEndereco({
        address: { city: 'Cidade Fantasia', state: 'Estado Inexistente' },
      }),
    ).toBe('Cidade Fantasia - Estado Inexistente');
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

describe('backoff ao levar 429', () => {
  it('para de chamar o Nominatim depois da primeira recusa', async () => {
    const prisma = {
      geoAddress: { findMany: jest.fn().mockResolvedValue([]) },
    } as never;
    const servico = new ReverseGeocodeService(prisma);

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => null },
    } as never);

    // Primeira tentativa fala com o Nominatim e leva a recusa.
    expect(await servico.lookupNow({ latitude: -22.9, longitude: -43.1 })).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // As seguintes nem saem: insistir só renovaria o bloqueio.
    expect(await servico.lookupNow({ latitude: -22.8, longitude: -43.2 })).toBeNull();
    expect(await servico.lookupNow({ latitude: -22.7, longitude: -43.3 })).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });
});

describe('provedor configurável — geocoder próprio vs Nominatim', () => {
  afterEach(() => jest.restoreAllMocks());

  it('com GEOCODER_URL e GEOCODER_API_KEY setados, consulta o geocoder próprio levando a key', async () => {
    const config = configFake({
      'geocoder.baseUrl': 'http://localhost:3010',
      'geocoder.apiKey': 'minha-chave',
    });
    const servico = new ReverseGeocodeService(prismaFakeVazio(), config);

    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        respostaOk({ road: 'Gallerie Charles Despeaux', city: 'Monaco', state: 'Monaco' }),
      );

    await servico.lookupNow({ latitude: 43.7384, longitude: 7.4246 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [urlChamada] = fetchSpy.mock.calls[0];
    expect(String(urlChamada)).toBe(
      'http://localhost:3010/reverse?lat=43.7384&lon=7.4246&key=minha-chave',
    );
  });

  it('faltando a URL ou a chave, continua indo pro Nominatim exatamente como hoje', async () => {
    // Só a chave, sem a URL — não basta metade da configuração.
    const config = configFake({ 'geocoder.apiKey': 'minha-chave' });
    const servico = new ReverseGeocodeService(prismaFakeVazio(), config);

    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(respostaOk({ road: 'Rua X', city: 'Salvador', state: 'Bahia' }));

    await servico.lookupNow({ latitude: -12.9, longitude: -38.5 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [urlChamada] = fetchSpy.mock.calls[0];
    expect(String(urlChamada)).toContain('https://nominatim.openstreetmap.org/reverse');
  });

  it('sem ConfigService nenhum (como os testes antigos instanciam), continua indo pro Nominatim', async () => {
    const servico = new ReverseGeocodeService(prismaFakeVazio());

    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(respostaOk({ road: 'Rua Y', city: 'Recife', state: 'Pernambuco' }));

    await servico.lookupNow({ latitude: -8.05, longitude: -34.9 });

    const [urlChamada] = fetchSpy.mock.calls[0];
    expect(String(urlChamada)).toContain('https://nominatim.openstreetmap.org/reverse');
  });
});

describe('portão de 1/s — só vale para o Nominatim público', () => {
  afterEach(() => jest.restoreAllMocks());

  it('não serializa chamadas consecutivas ao geocoder próprio', async () => {
    const config = configFake({
      'geocoder.baseUrl': 'http://localhost:3010',
      'geocoder.apiKey': 'minha-chave',
    });
    const servico = new ReverseGeocodeService(prismaFakeVazio(), config);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(respostaOk({ road: 'Rua A', city: 'B', state: 'Bahia' }));

    // Se o portão valesse aqui, a segunda chamada agendaria uma espera via
    // setTimeout (ver `aguardarVez`/`proximoSlot`). Sem o portão, nenhuma.
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as never);

    await servico.lookupNow({ latitude: 1, longitude: 1 });
    await servico.lookupNow({ latitude: 2, longitude: 2 });

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('continua serializando chamadas consecutivas ao Nominatim', async () => {
    const servico = new ReverseGeocodeService(prismaFakeVazio());
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(respostaOk({ road: 'Rua A', city: 'B', state: 'Bahia' }));

    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as never);

    await servico.lookupNow({ latitude: 1, longitude: 1 });
    // A segunda chamada cai dentro do intervalo de 1,1s reservado pela
    // primeira — o portão agenda espera via setTimeout.
    await servico.lookupNow({ latitude: 2, longitude: 2 });

    expect(setTimeoutSpy).toHaveBeenCalled();
  });
});

describe('backoff ao levar 429 — cada provedor tem o seu, um não trava o outro', () => {
  afterEach(() => jest.restoreAllMocks());

  /** Roteia a resposta pelo destino: URL do próprio vs Nominatim público. */
  function fetchRoteado(
    respostaProprio: () => Promise<unknown>,
    respostaNominatim: () => Promise<unknown> = () =>
      Promise.resolve(respostaOk({ road: 'Rua B', city: 'Recife', state: 'Pernambuco' })),
  ) {
    return jest.spyOn(global, 'fetch').mockImplementation(((url: string) =>
      String(url).includes('localhost:3010') ? respostaProprio() : respostaNominatim()) as never);
  }

  it('geocoder próprio recusa com 429 — o Nominatim NÃO fica bloqueado e resolve o mesmo pedido', async () => {
    const config = configFake({
      'geocoder.baseUrl': 'http://localhost:3010',
      'geocoder.apiKey': 'minha-chave',
    });
    const servico = new ReverseGeocodeService(prismaFakeVazio(), config);
    const fetchSpy = fetchRoteado(() =>
      Promise.resolve({ ok: false, status: 429, headers: { get: () => null } } as never),
    );

    // Antes desta correção, o 429 do próprio parava o serviço inteiro por 10
    // minutos e o Nominatim nunca era tentado — exatamente a falha do achado.
    const endereco = await servico.lookupNow({ latitude: 1, longitude: 1 });

    expect(endereco).toBe('Rua B, Recife - PE');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toContain('nominatim.openstreetmap.org');
  });

  it('depois do 429, o próprio fica de castigo mas o Nominatim segue liberado nas próximas buscas', async () => {
    const config = configFake({
      'geocoder.baseUrl': 'http://localhost:3010',
      'geocoder.apiKey': 'minha-chave',
    });
    const servico = new ReverseGeocodeService(prismaFakeVazio(), config);
    const fetchSpy = fetchRoteado(() =>
      Promise.resolve({ ok: false, status: 429, headers: { get: () => null } } as never),
    );

    await servico.lookupNow({ latitude: 1, longitude: 1 }); // 2 chamadas: próprio (429) + Nominatim (ok)
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Segunda busca: o próprio está de castigo (nem é chamado de novo) — só
    // o Nominatim é tentado, e ele não herdou bloqueio nenhum do próprio.
    const segundo = await servico.lookupNow({ latitude: 2, longitude: 2 });
    expect(segundo).toBe('Rua B, Recife - PE');
    expect(fetchSpy).toHaveBeenCalledTimes(3); // só +1 chamada, e foi pro Nominatim
    expect(String(fetchSpy.mock.calls[2][0])).toContain('nominatim.openstreetmap.org');
  });
});

describe('fallback pro Nominatim quando o geocoder próprio falha (sem 429)', () => {
  afterEach(() => jest.restoreAllMocks());

  function fetchRoteado(respostaProprio: () => Promise<unknown>) {
    return jest.spyOn(global, 'fetch').mockImplementation(((url: string) =>
      String(url).includes('localhost:3010')
        ? respostaProprio()
        : Promise.resolve(respostaOk({ road: 'Rua do Fallback', city: 'Rio de Janeiro', state: 'Rio de Janeiro' }))) as never);
  }

  it('erro de rede no próprio: cai pro Nominatim uma vez e o endereço volta', async () => {
    const config = configFake({
      'geocoder.baseUrl': 'http://localhost:3010',
      'geocoder.apiKey': 'minha-chave',
    });
    const servico = new ReverseGeocodeService(prismaFakeVazio(), config);
    const fetchSpy = fetchRoteado(() => Promise.reject(new Error('ECONNREFUSED')));

    const endereco = await servico.lookupNow({ latitude: 1, longitude: 1 });

    expect(endereco).toBe('Rua do Fallback, Rio de Janeiro - RJ');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('corpo ilegível do próprio também cai pro Nominatim', async () => {
    const config = configFake({
      'geocoder.baseUrl': 'http://localhost:3010',
      'geocoder.apiKey': 'minha-chave',
    });
    const servico = new ReverseGeocodeService(prismaFakeVazio(), config);
    const fetchSpy = fetchRoteado(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => {
          throw new Error('corpo não é JSON');
        },
      } as never),
    );

    const endereco = await servico.lookupNow({ latitude: 3, longitude: 3 });

    expect(endereco).toBe('Rua do Fallback, Rio de Janeiro - RJ');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('status não-OK do próprio (sem ser 429) também cai pro Nominatim', async () => {
    const config = configFake({
      'geocoder.baseUrl': 'http://localhost:3010',
      'geocoder.apiKey': 'minha-chave',
    });
    const servico = new ReverseGeocodeService(prismaFakeVazio(), config);
    const fetchSpy = fetchRoteado(() =>
      Promise.resolve({ ok: false, status: 500, headers: { get: () => null } } as never),
    );

    const endereco = await servico.lookupNow({ latitude: 4, longitude: 4 });

    expect(endereco).toBe('Rua do Fallback, Rio de Janeiro - RJ');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('a chamada de fallback respeita o portão de 1/s do Nominatim', async () => {
    const config = configFake({
      'geocoder.baseUrl': 'http://localhost:3010',
      'geocoder.apiKey': 'minha-chave',
    });
    const servico = new ReverseGeocodeService(prismaFakeVazio(), config);
    fetchRoteado(() => Promise.reject(new Error('ECONNREFUSED')));

    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as never);

    await servico.lookupNow({ latitude: 1, longitude: 1 }); // primeiro fallback: sem espera (primeiro slot)
    await servico.lookupNow({ latitude: 2, longitude: 2 }); // segundo fallback: cai dentro do intervalo reservado

    expect(setTimeoutSpy).toHaveBeenCalled();
  });

  it('não insiste em loop — no máximo uma tentativa por provedor por busca', async () => {
    const config = configFake({
      'geocoder.baseUrl': 'http://localhost:3010',
      'geocoder.apiKey': 'minha-chave',
    });
    const servico = new ReverseGeocodeService(prismaFakeVazio(), config);
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('rede fora do ar'));

    const endereco = await servico.lookupNow({ latitude: 1, longitude: 1 });

    expect(endereco).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2); // 1 próprio + 1 Nominatim, nunca mais que isso
  });
});

describe('a key do geocoder próprio nunca aparece no log', () => {
  afterEach(() => jest.restoreAllMocks());

  it('URL base mal formada gera erro citando a URL inteira — o log não pode repetir a key', async () => {
    const config = configFake({
      'geocoder.baseUrl': 'http://localhost:3010',
      'geocoder.apiKey': 'SEGREDO123',
    });
    const servico = new ReverseGeocodeService(prismaFakeVazio(), config);

    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // Reproduz o erro real do achado: fetch() de uma URL mal formada rejeita
    // com uma mensagem que cita a URL inteira, key incluída.
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(
        new TypeError(
          'Failed to parse URL from http://localhost:3010/reverse?lat=1&lon=1&key=SEGREDO123',
        ),
      )
      .mockResolvedValueOnce(respostaOk({ road: 'Rua E', city: 'B', state: 'Bahia' }));

    await servico.lookupNow({ latitude: 1, longitude: 1 });

    const textoLogado = warnSpy.mock.calls.map((chamada) => String(chamada[0])).join('\n');
    expect(textoLogado).not.toContain('SEGREDO123');
  });
});
