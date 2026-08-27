import {
  horaLocal,
  distanciaMetros,
  clusterizar,
  segmentar,
  detectarLocaisHabituais,
  detectarPernoite,
  detectarUltimaParada,
  PontoBruto,
} from './tag-insights';
import { buildDemoSightings, CASA, TRABALHO } from './demo-sightings';

const P = (lat: number, lng: number, iso: string, acc = 40): PontoBruto => ({
  lat,
  lng,
  accuracy: acc,
  seenAt: new Date(iso),
});

const demo = (): PontoBruto[] =>
  buildDemoSightings('d', 't', new Date('2026-08-20T03:00:00.000Z')).map(
    (s) => ({
      lat: s.scannerLat,
      lng: s.scannerLng,
      accuracy: s.accuracy,
      seenAt: s.seenAt,
    }),
  );

describe('primitivas', () => {
  it('horaLocal aplica o deslocamento de -3', () => {
    expect(horaLocal(new Date('2026-08-20T03:00:00Z'))).toBe(0);
    expect(horaLocal(new Date('2026-08-20T02:00:00Z'))).toBe(23);
    expect(horaLocal(new Date('2026-08-20T15:00:00Z'))).toBe(12);
  });

  it('distanciaMetros dá ~111 m para 0.001 grau de latitude', () => {
    const d = distanciaMetros(-22.939, -43.56, -22.94, -43.56);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(115);
  });

  it('distanciaMetros é zero para o mesmo ponto', () => {
    expect(distanciaMetros(-22.939, -43.56, -22.939, -43.56)).toBeCloseTo(0, 5);
  });
});

describe('clusterizar', () => {
  it('agrupa pontos próximos e separa os distantes', () => {
    const pts = [
      P(-22.939, -43.56, '2026-08-20T03:00:00Z'),
      P(-22.9391, -43.5601, '2026-08-20T03:20:00Z'),
      P(-22.9812, -43.5822, '2026-08-20T12:00:00Z'),
    ];
    const cl = clusterizar(pts, 150);
    expect(cl.length).toBe(2);
    expect(cl.find((c) => c.pontos.length === 2)).toBeDefined();
  });

  it('conta os avistamentos por hora local', () => {
    const pts = [
      P(-22.939, -43.56, '2026-08-20T03:00:00Z'), // 00h local
      P(-22.939, -43.56, '2026-08-20T03:30:00Z'), // 00h local
      P(-22.939, -43.56, '2026-08-20T15:00:00Z'), // 12h local
    ];
    const [c] = clusterizar(pts, 150);
    expect(c.porHora[0]).toBe(2);
    expect(c.porHora[12]).toBe(1);
  });

  it('devolve lista vazia para entrada vazia', () => {
    expect(clusterizar([], 150)).toEqual([]);
  });
});

describe('segmentar', () => {
  it('quebra a trilha quando há buraco maior que o limite', () => {
    const pts = [
      P(-22.939, -43.56, '2026-08-20T03:00:00Z'),
      P(-22.939, -43.56, '2026-08-20T03:10:00Z'),
      P(-22.981, -43.582, '2026-08-20T09:00:00Z'),
    ];
    const seg = segmentar(pts, 30);
    expect(seg.length).toBe(2);
    expect(seg[0].pontos.length).toBe(2);
    expect(seg[1].pontos.length).toBe(1);
  });

  it('mantém um só segmento quando os intervalos são curtos', () => {
    const pts = [
      P(-22.939, -43.56, '2026-08-20T03:00:00Z'),
      P(-22.939, -43.56, '2026-08-20T03:10:00Z'),
      P(-22.939, -43.56, '2026-08-20T03:20:00Z'),
    ];
    expect(segmentar(pts, 30).length).toBe(1);
  });

  it('ordena antes de segmentar (entrada fora de ordem não inventa buraco)', () => {
    const pts = [
      P(-22.939, -43.56, '2026-08-20T03:20:00Z'),
      P(-22.939, -43.56, '2026-08-20T03:00:00Z'),
      P(-22.939, -43.56, '2026-08-20T03:10:00Z'),
    ];
    expect(segmentar(pts, 30).length).toBe(1);
  });

  it('devolve vazio para entrada vazia', () => {
    expect(segmentar([], 30)).toEqual([]);
  });
});

describe('detecções sobre a história semeada', () => {
  it('locais habituais trazem CASA e TRABALHO no topo', () => {
    const h = detectarLocaisHabituais(demo());
    expect(h.length).toBeGreaterThanOrEqual(2);
    expect(h[0].diasDistintos).toBe(7);
    const topo = [h[0], h[1]];
    const temCasa = topo.some(
      (l) => Math.abs(l.centroLat - CASA.lat) < 0.003,
    );
    const temTrabalho = topo.some(
      (l) => Math.abs(l.centroLat - TRABALHO.lat) < 0.003,
    );
    expect(temCasa).toBe(true);
    expect(temTrabalho).toBe(true);
  });

  it('local habitual reporta faixa horária e participação', () => {
    const [primeiro] = detectarLocaisHabituais(demo());
    expect(primeiro.faixaHorariaTexto).toMatch(/\d{2}h/);
    expect(primeiro.participacaoPct).toBeGreaterThan(0);
    expect(primeiro.participacaoPct).toBeLessThanOrEqual(100);
  });

  it('pernoite aponta a CASA', () => {
    const p = detectarPernoite(demo());
    expect(p).not.toBeNull();
    expect(Math.abs(p!.centroLat - CASA.lat)).toBeLessThan(0.003);
    expect(p!.diasDistintos).toBeGreaterThanOrEqual(3);
  });

  it('última parada: parado na CASA no fim da janela, ainda lá', () => {
    const pts = demo();
    const agora = new Date(pts[pts.length - 1].seenAt.getTime() + 60000);
    const u = detectarUltimaParada(pts, agora);
    expect(u).not.toBeNull();
    expect(u!.aindaLa).toBe(true);
    expect(Math.abs(u!.centroLat - CASA.lat)).toBeLessThan(0.003);
    expect(u!.paradoDesde.getTime()).toBeLessThan(u!.ultimoAvistamento.getTime());
  });

  it('última parada marca aindaLa=false quando o avistamento envelheceu', () => {
    const pts = demo();
    const agora = new Date(
      pts[pts.length - 1].seenAt.getTime() + 3 * 3600000,
    );
    const u = detectarUltimaParada(pts, agora);
    expect(u!.aindaLa).toBe(false);
  });
});

describe('detecções em cenários pobres (não inventar padrão)', () => {
  it('pernoite é nulo quando não há avistamento noturno', () => {
    const pts = [
      P(-22.939, -43.56, '2026-08-20T15:00:00Z'),
      P(-22.939, -43.56, '2026-08-20T16:00:00Z'),
    ];
    expect(detectarPernoite(pts)).toBeNull();
  });

  it('pernoite é nulo com menos de 3 noites distintas', () => {
    const pts = [
      P(-22.939, -43.56, '2026-08-20T04:00:00Z'),
      P(-22.939, -43.56, '2026-08-21T04:00:00Z'),
    ];
    expect(detectarPernoite(pts)).toBeNull();
  });

  it('locais habituais some quando faltam avistamentos suficientes', () => {
    const pts = [P(-22.939, -43.56, '2026-08-20T04:00:00Z')];
    expect(detectarLocaisHabituais(pts)).toEqual([]);
  });

  it('última parada é nula sem pontos', () => {
    expect(detectarUltimaParada([], new Date())).toBeNull();
  });
});
