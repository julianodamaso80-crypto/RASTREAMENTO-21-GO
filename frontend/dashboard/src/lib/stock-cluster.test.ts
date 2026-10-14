import type { StockMapPoint } from '@/types/stock';
import { indexarPontos, itensVisiveis } from './stock-cluster';

function ponto(id: string, latitude: number | null, longitude: number | null): StockMapPoint {
  return {
    id,
    imei: `86${id.padStart(13, '0')}`,
    iccid: null,
    line: null,
    operator: null,
    server: null,
    statusChip: null,
    validatedAt: null,
    validationOk: null,
    tecnico: null,
    conexao: 'ONLINE',
    lastUpdate: null,
    fixTime: null,
    idadeSegundos: null,
    latitude,
    longitude,
    endereco: null,
    gpsConfiavel: true,
    ignicao: null,
    velocidade: null,
    direcao: null,
    volts: null,
    faixaEnergia: 'ok',
    satelites: null,
    bateriaInterna: null,
    bloqueado: false,
  };
}

// Pseudoaleatório determinístico: o teste não pode variar de uma rodada a outra.
function gerador(semente: number) {
  let s = semente;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

/** `n` pontos espalhados num quadrado de ~1 km em Copacabana. */
function bairro(n: number, prefixo = 'p'): StockMapPoint[] {
  const rnd = gerador(42);
  return Array.from({ length: n }, (_, i) =>
    ponto(`${prefixo}${i}`, -22.97 + rnd() * 0.009, -43.19 + rnd() * 0.009),
  );
}

const BBOX_RIO: [number, number, number, number] = [-43.8, -23.1, -43.0, -22.7];
const BBOX_BAIRRO: [number, number, number, number] = [-43.2, -22.98, -43.17, -22.95];

describe('stock-cluster', () => {
  it('9.000 pontos no mesmo bairro em zoom 10 viram no máximo 50 itens', () => {
    const indice = indexarPontos(bairro(9_000));
    const { clusters, pontos } = itensVisiveis(indice, BBOX_RIO, 10, new Set());
    expect(clusters.length + pontos.length).toBeLessThanOrEqual(50);
    expect(clusters.length).toBeGreaterThan(0);
    // Nenhum equipamento some: a soma dos grupos e dos soltos é o total.
    const total = clusters.reduce((s, c) => s + c.total, 0) + pontos.length;
    expect(total).toBe(9_000);
  });

  it('cluster traz id, coordenada e quantidade', () => {
    const indice = indexarPontos(bairro(500));
    const { clusters } = itensVisiveis(indice, BBOX_RIO, 10, new Set());
    for (const c of clusters) {
      expect(typeof c.id).toBe('number');
      expect(c.total).toBeGreaterThan(1);
      expect(c.lngLat[0]).toBeGreaterThan(-43.2);
      expect(c.lngLat[0]).toBeLessThan(-43.17);
      expect(c.lngLat[1]).toBeGreaterThan(-22.98);
      expect(c.lngLat[1]).toBeLessThan(-22.95);
    }
  });

  it('fixos fora do bbox aparecem como pontos individuais', () => {
    const longe = ponto('longe', -15.79, -47.88); // Brasília
    const indice = indexarPontos([...bairro(1_000), longe]);
    const { pontos } = itensVisiveis(indice, BBOX_RIO, 10, new Set(['longe']));
    expect(pontos.map((p) => p.id)).toContain('longe');
    expect(pontos.find((p) => p.id === 'longe')).toBe(longe);
  });

  it('fixo dentro de um cluster também sai como ponto, sem duplicar', () => {
    const pontosBairro = bairro(1_000);
    const indice = indexarPontos(pontosBairro);
    const { pontos } = itensVisiveis(indice, BBOX_RIO, 10, new Set(['p7']));
    expect(pontos.filter((p) => p.id === 'p7')).toHaveLength(1);
  });

  it('fixo sem coordenada ou inexistente não quebra nem aparece', () => {
    const semPosicao = ponto('sem', null, null);
    const indice = indexarPontos([...bairro(10), semPosicao]);
    const { pontos } = itensVisiveis(indice, BBOX_RIO, 18, new Set(['sem', 'nao-existe']));
    expect(pontos.map((p) => p.id)).not.toContain('sem');
    expect(pontos.map((p) => p.id)).not.toContain('nao-existe');
  });

  it('pontos sem coordenada não entram no índice', () => {
    const indice = indexarPontos([
      ponto('a', -22.97, -43.19),
      ponto('b', null, null),
      ponto('c', -22.96, null),
      ponto('d', null, -43.18),
    ]);
    const { clusters, pontos } = itensVisiveis(indice, [-180, -85, 180, 85], 18, new Set());
    expect(clusters).toHaveLength(0);
    expect(pontos.map((p) => p.id)).toEqual(['a']);
  });

  it('zoom 18 mostra cada ponto sozinho', () => {
    const indice = indexarPontos(bairro(300));
    const { clusters, pontos } = itensVisiveis(indice, BBOX_BAIRRO, 18, new Set());
    expect(clusters).toHaveLength(0);
    expect(pontos).toHaveLength(300);
  });

  it('só devolve o que está no bbox', () => {
    const indice = indexarPontos([ponto('rio', -22.97, -43.19), ponto('sp', -23.55, -46.63)]);
    const { pontos } = itensVisiveis(indice, BBOX_RIO, 18, new Set());
    expect(pontos.map((p) => p.id)).toEqual(['rio']);
  });

  it('bbox maior que o mundo e zoom fora da faixa não quebram', () => {
    const indice = indexarPontos(bairro(100));
    expect(() => itensVisiveis(indice, [-400, -120, 400, 120], 0, new Set())).not.toThrow();
    expect(() => itensVisiveis(indice, [-400, -120, 400, 120], 25.7, new Set())).not.toThrow();
    const { clusters, pontos } = itensVisiveis(indice, [-400, -120, 400, 120], 25.7, new Set());
    expect(clusters.length + pontos.length).toBe(100);
  });

  it('índice vazio devolve nada', () => {
    const indice = indexarPontos([]);
    expect(itensVisiveis(indice, BBOX_RIO, 10, new Set(['x']))).toEqual({ clusters: [], pontos: [] });
  });
});
