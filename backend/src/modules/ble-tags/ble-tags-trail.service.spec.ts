import { BleTagsService } from './ble-tags.service';
import { buildDemoSightings, CASA } from './demo-sightings';

function fakeSighting(overrides: Record<string, unknown> = {}) {
  return {
    scannerLat: -22.939,
    scannerLng: -43.56,
    accuracy: 40,
    seenAt: new Date('2026-08-20T03:00:00Z'),
    createdAt: new Date('2026-08-20T03:03:00Z'),
    ...overrides,
  };
}

/** Monta o service sem passar pelo Nest: só o que os métodos usam. */
function montarService(rows: unknown[], geocode?: unknown): any {
  const service: any = Object.create(BleTagsService.prototype);
  service.findOne = jest.fn().mockResolvedValue({ id: 'd' });
  service.logger = { warn: jest.fn(), debug: jest.fn() };
  Object.defineProperty(service, 'sightingModel', {
    value: { findMany: jest.fn().mockResolvedValue(rows) },
    configurable: true,
  });
  service.geocode = geocode;
  return service;
}

describe('getTrail', () => {
  it('segmenta por buraco de sinal e calcula a latência de cada ponto', async () => {
    const service = montarService([
      fakeSighting({ seenAt: new Date('2026-08-20T03:00:00Z') }),
      fakeSighting({
        seenAt: new Date('2026-08-20T03:10:00Z'),
        createdAt: new Date('2026-08-20T03:12:00Z'),
      }),
      // 5h50 depois e a quilômetros dali: segmento novo.
      fakeSighting({
        seenAt: new Date('2026-08-20T09:00:00Z'),
        createdAt: new Date('2026-08-20T09:05:00Z'),
        scannerLat: -22.981,
        scannerLng: -43.582,
      }),
    ]);

    const r = await service.getTrail('d', 't', {});

    expect(r.totalAvistamentos).toBe(3);
    expect(r.segmentos.length).toBe(2);
    expect(r.segmentos[0].pontos.length).toBe(2);
    expect(r.segmentos[1].pontos.length).toBe(1);
    expect(r.segmentos[0].pontos[0].latenciaSeg).toBe(180);
    expect(r.segmentos[0].pontos[1].latenciaSeg).toBe(120);
  });

  it('nunca devolve latência negativa (relógio torto não vira dado torto)', async () => {
    const service = montarService([
      fakeSighting({
        seenAt: new Date('2026-08-20T03:10:00Z'),
        createdAt: new Date('2026-08-20T03:00:00Z'),
      }),
    ]);

    const r = await service.getTrail('d', 't', {});
    expect(r.segmentos[0].pontos[0].latenciaSeg).toBe(0);
  });

  it('ignora avistamento sem coordenada', async () => {
    const service = montarService([
      fakeSighting(),
      fakeSighting({ scannerLat: null, scannerLng: null }),
    ]);

    const r = await service.getTrail('d', 't', {});
    expect(r.totalAvistamentos).toBe(1);
  });

  it('devolve vazio sem quebrar quando não há avistamento', async () => {
    const service = montarService([]);
    const r = await service.getTrail('d', 't', {});
    expect(r).toEqual({ segmentos: [], totalAvistamentos: 0 });
  });

  it('repassa a janela de datas para a consulta', async () => {
    const service = montarService([]);
    await service.getTrail('d', 't', {
      from: '2026-08-20T00:00:00Z',
      to: '2026-08-21T00:00:00Z',
    });

    const where = service.sightingModel.findMany.mock.calls[0][0].where;
    expect(where.deviceId).toBe('d');
    expect(where.tenantId).toBe('t');
    expect(where.seenAt.gte).toEqual(new Date('2026-08-20T00:00:00Z'));
    expect(where.seenAt.lte).toEqual(new Date('2026-08-21T00:00:00Z'));
  });

  it('exige que a TAG pertença ao tenant (findOne é o guardião)', async () => {
    const service = montarService([]);
    service.findOne = jest.fn().mockRejectedValue(new Error('não é sua'));
    await expect(service.getTrail('d', 'outro', {})).rejects.toThrow('não é sua');
  });
});

describe('getInsights', () => {
  const base = new Date('2026-08-20T03:00:00.000Z');

  function geocodeFalso(endereco = 'Rua Demo, Campo Grande') {
    return {
      lookupCached: jest.fn().mockResolvedValue(new Map([['k', endereco]])),
      chave: jest.fn().mockReturnValue('k'),
    };
  }

  it('narra pernoite, locais habituais e última parada com endereço', async () => {
    const rows = buildDemoSightings('d', 't', base);
    const agora = new Date(rows[rows.length - 1].seenAt.getTime() + 60000);
    const service = montarService(
      rows.map((s) => ({ ...s, createdAt: s.seenAt })),
      geocodeFalso(),
    );

    const r = await service.getInsights('d', 't', { days: 7 }, agora);

    expect(r.janelaDias).toBe(7);
    expect(r.totalAvistamentos).toBe(rows.length);
    expect(r.locaisHabituais.length).toBeGreaterThanOrEqual(2);
    expect(r.locaisHabituais[0].endereco).toContain('Rua Demo');
    expect(r.pernoite).not.toBeNull();
    expect(Math.abs(r.pernoite.centroLat - CASA.lat)).toBeLessThan(0.003);
    expect(r.ultimaParada.aindaLa).toBe(true);
    expect(r.ultimaParada.endereco).toContain('Rua Demo');
  });

  it('funciona sem geocoder — endereço vira nulo, não exceção', async () => {
    const rows = buildDemoSightings('d', 't', base);
    const agora = new Date(rows[rows.length - 1].seenAt.getTime() + 60000);
    const service = montarService(
      rows.map((s) => ({ ...s, createdAt: s.seenAt })),
      undefined,
    );

    const r = await service.getInsights('d', 't', { days: 7 }, agora);
    expect(r.pernoite.endereco).toBeNull();
    expect(r.locaisHabituais[0].endereco).toBeNull();
  });

  it('geocoder fora do ar não derruba o histórico', async () => {
    const rows = buildDemoSightings('d', 't', base);
    const agora = new Date(rows[rows.length - 1].seenAt.getTime() + 60000);
    const service = montarService(
      rows.map((s) => ({ ...s, createdAt: s.seenAt })),
      {
        lookupCached: jest.fn().mockRejectedValue(new Error('OSM fora')),
        chave: jest.fn().mockReturnValue('k'),
      },
    );

    const r = await service.getInsights('d', 't', { days: 7 }, agora);
    expect(r.totalAvistamentos).toBe(rows.length);
    expect(r.pernoite.endereco).toBeNull();
  });

  it('sem avistamentos devolve estrutura vazia coerente', async () => {
    const service = montarService([], geocodeFalso());
    const r = await service.getInsights('d', 't', {}, new Date());

    expect(r.totalAvistamentos).toBe(0);
    expect(r.locaisHabituais).toEqual([]);
    expect(r.pernoite).toBeNull();
    expect(r.ultimaParada).toBeNull();
  });

  it('usa janela de 7 dias por padrão e respeita days quando informado', async () => {
    const service = montarService([], geocodeFalso());
    const agora = new Date('2026-08-27T12:00:00Z');

    await service.getInsights('d', 't', {}, agora);
    let where = service.sightingModel.findMany.mock.calls[0][0].where;
    expect(where.seenAt.gte).toEqual(new Date('2026-08-20T12:00:00Z'));

    await service.getInsights('d', 't', { days: 1 }, agora);
    where = service.sightingModel.findMany.mock.calls[1][0].where;
    expect(where.seenAt.gte).toEqual(new Date('2026-08-26T12:00:00Z'));
  });
});
