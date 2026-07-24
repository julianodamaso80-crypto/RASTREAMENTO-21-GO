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
  it('junta pontos vizinhos e separa os distantes', () => {
    const clusters = agrupar([CAMPO_GRANDE, CAMPO_GRANDE2, RECREIO, NITEROI], 4);
    // CG + CG2 (250m) na mesma célula; Recreio e Niterói longe, cada um na sua.
    expect(clusters).toHaveLength(3);
    expect(clusters[0].pontos).toHaveLength(2);
    expect(clusters[0].pontos.map((p) => p.id).sort()).toEqual(['cg', 'cg2']);
  });

  it('ordena os bolsões do maior pro menor', () => {
    const clusters = agrupar([CAMPO_GRANDE, CAMPO_GRANDE2, RECREIO], 4);
    expect(clusters[0].pontos.length).toBeGreaterThanOrEqual(
      clusters[1].pontos.length,
    );
  });

  it('calcula raio 0 pra bolsão de um ponto só', () => {
    const clusters = agrupar([NITEROI], 4);
    expect(clusters[0].raioKm).toBeCloseTo(0, 5);
  });

  it('devolve vazio sem pontos', () => {
    expect(agrupar([], 4)).toEqual([]);
  });

  /**
   * A regressão que motivou a troca de algoritmo: em produção, uma cadeia densa
   * de pontos virava um bolsão único de 42 km de raio. A grade tem que manter o
   * raio limitado mesmo com pontos enfileirados por dezenas de quilômetros.
   */
  it('não encadeia: linha longa de pontos vira vários bolsões de raio pequeno', () => {
    const linha = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      lat: -22.9,
      lng: -43.7 + i * 0.02, // ~2km entre vizinhos, ~80km de ponta a ponta
    }));

    const clusters = agrupar(linha, 4);

    expect(clusters.length).toBeGreaterThan(5);
    for (const c of clusters) {
      // Meia diagonal de uma célula de 4km ≈ 2.9km; folga pra arredondamento.
      expect(c.raioKm).toBeLessThan(3.5);
    }
  });

  it('não perde nem duplica pontos ao agrupar', () => {
    const linha = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      lat: -22.9 + i * 0.01,
      lng: -43.5,
    }));
    const total = agrupar(linha, 4).reduce((s, c) => s + c.pontos.length, 0);
    expect(total).toBe(40);
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
