import { mapearTagRdv, parsePosicao, parseVistoEm } from './rdv-tag-import';

describe('parsePosicao', () => {
  it('lê o formato "lat|lng" que a origem manda', () => {
    expect(parsePosicao('-22.938804|-43.560138')).toEqual({
      lat: -22.938804,
      lng: -43.560138,
    });
  });

  it('coordenada ausente não vira zero', () => {
    // (0,0) é no golfo da Guiné. Virar zero colocaria a TAG no oceano e o
    // operador leria isso como posição de verdade.
    expect(parsePosicao(null)).toBeNull();
    expect(parsePosicao('')).toBeNull();
    expect(parsePosicao('0|0')).toBeNull();
    expect(parsePosicao('|')).toBeNull();
    expect(parsePosicao('abc|def')).toBeNull();
  });

  it('recusa coordenada fora do planeta', () => {
    expect(parsePosicao('999|-43.5')).toBeNull();
    expect(parsePosicao('-22.9|181')).toBeNull();
  });
});

describe('parseVistoEm', () => {
  it('converte a hora de Brasília da origem pra UTC', () => {
    // A origem escreve em -03 sem fuso no texto. Guardar como se fosse UTC
    // atrasaria toda TAG em 3 horas.
    expect(parseVistoEm('2026-08-27 10:50:34')?.toISOString()).toBe(
      '2026-08-27T13:50:34.000Z',
    );
  });

  it('data ausente ou zerada vira nulo', () => {
    expect(parseVistoEm(null)).toBeNull();
    expect(parseVistoEm('')).toBeNull();
    expect(parseVistoEm('0000-00-00 00:00:00')).toBeNull();
  });
});

describe('mapearTagRdv', () => {
  const bruta = {
    placa: 'net9d82 ',
    imei: '000092603014784',
    latLng: '-22.9390615|-43.560026',
    visto: '2026-04-15 14:13:58',
    chassi: '93HGM2510DZ131662',
    idAtivo: '808442',
  };

  it('monta a linha do espelho pronta pro banco', () => {
    expect(mapearTagRdv(bruta, { KTAG: ['NET9D82'] })).toEqual({
      tagIdentifier: '000092603014784',
      plate: 'NET9D82',
      chassi: '93HGM2510DZ131662',
      tagModel: 'KTAG',
      lastLat: -22.9390615,
      lastLng: -43.560026,
      seenAt: new Date('2026-04-15T17:13:58.000Z'),
      sourceAssetId: '808442',
    });
  });

  it('TAG sem posição entra mesmo assim — sabemos qual é, não onde está', () => {
    const r = mapearTagRdv({ ...bruta, latLng: null, visto: null }, {});
    expect(r?.tagIdentifier).toBe('000092603014784');
    expect(r?.lastLat).toBeNull();
    expect(r?.seenAt).toBeNull();
  });

  it('sem identificador não entra: linha sem chave é lixo', () => {
    expect(mapearTagRdv({ ...bruta, imei: '' }, {})).toBeNull();
    expect(mapearTagRdv({ ...bruta, imei: null }, {})).toBeNull();
  });

  it('sem placa não entra: o cruzamento é por placa', () => {
    expect(mapearTagRdv({ ...bruta, placa: '' }, {})).toBeNull();
  });

  it('modelo desconhecido fica nulo em vez de chutar', () => {
    expect(mapearTagRdv(bruta, {})?.tagModel).toBeNull();
  });
});
