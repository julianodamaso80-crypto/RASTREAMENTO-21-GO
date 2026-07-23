import { agrupar, distanciaKm, ordenarRota } from './route-geo';

// Coordenadas reais do RJ pra dar sentido geográfico aos testes.
const CAMPO_GRANDE = { id: 'cg', lat: -22.9016, lng: -43.5605 };
const CAMPO_GRANDE2 = { id: 'cg2', lat: -22.9035, lng: -43.5588 }; // ~250m
const RECREIO = { id: 'rec', lat: -23.0276, lng: -43.4771 }; // ~17km
const NITEROI = { id: 'nit', lat: -22.8833, lng: -43.1036 }; // ~46km

describe('distanciaKm', () => {
  it('é ~0 pro mesmo ponto', () => {
    expect(distanciaKm(CAMPO_GRANDE, CAMPO_GRANDE)).toBeCloseTo(0, 5);
  });

  it('mede a distância conhecida entre bairros', () => {
    const d = distanciaKm(CAMPO_GRANDE, RECREIO);
    expect(d).toBeGreaterThan(14);
    expect(d).toBeLessThan(20);
  });
});

describe('agrupar', () => {
  it('junta pontos a menos do limite e separa os distantes', () => {
    const clusters = agrupar([CAMPO_GRANDE, CAMPO_GRANDE2, RECREIO, NITEROI], 2);
    // CG + CG2 num bolsão; Recreio e Niterói isolados.
    expect(clusters).toHaveLength(3);
    expect(clusters[0].pontos).toHaveLength(2);
    expect(clusters[0].pontos.map((p) => p.id).sort()).toEqual(['cg', 'cg2']);
  });

  it('ordena os bolsões do maior pro menor', () => {
    const clusters = agrupar([CAMPO_GRANDE, CAMPO_GRANDE2, RECREIO], 2);
    expect(clusters[0].pontos.length).toBeGreaterThanOrEqual(
      clusters[1].pontos.length,
    );
  });

  it('calcula raio 0 pra bolsão de um ponto só', () => {
    const clusters = agrupar([NITEROI], 2);
    expect(clusters[0].raioKm).toBeCloseTo(0, 5);
  });

  it('funde bolsões por transitividade (A-B-C em cadeia)', () => {
    const a = { id: 'a', lat: -22.9, lng: -43.5 };
    const b = { id: 'b', lat: -22.915, lng: -43.5 }; // ~1.7km de a
    const c = { id: 'c', lat: -22.93, lng: -43.5 }; // ~1.7km de b, ~3.3km de a
    // a não alcança c direto, mas alcança via b.
    expect(agrupar([a, b, c], 2)).toHaveLength(1);
  });
});

describe('ordenarRota', () => {
  it('mantém rotas de 1 ou 2 pontos como estão', () => {
    expect(ordenarRota([CAMPO_GRANDE])).toEqual([CAMPO_GRANDE]);
    expect(ordenarRota([CAMPO_GRANDE, RECREIO])).toHaveLength(2);
  });

  it('visita o vizinho mais próximo a cada passo', () => {
    // Linha oeste→leste: cada um mais próximo do anterior que dos outros.
    const p = [
      { id: '3', lat: -22.9, lng: -43.3 },
      { id: '1', lat: -22.9, lng: -43.5 },
      { id: '4', lat: -22.9, lng: -43.2 },
      { id: '2', lat: -22.9, lng: -43.4 },
    ];
    const ordem = ordenarRota(p, { lat: -22.9, lng: -43.6 }).map((x) => x.id);
    expect(ordem).toEqual(['1', '2', '3', '4']);
  });

  it('não perde nem duplica pontos', () => {
    const p = [CAMPO_GRANDE, CAMPO_GRANDE2, RECREIO, NITEROI];
    const ordem = ordenarRota(p);
    expect(ordem).toHaveLength(4);
    expect(new Set(ordem.map((x) => x.id)).size).toBe(4);
  });
});
