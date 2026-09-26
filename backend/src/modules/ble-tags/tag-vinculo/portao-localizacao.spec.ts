import {
  CONTRADICAO_M,
  DT_COMPARAVEL_MS,
  FOLGA_RASTREADOR_M,
  RAIO_PARADA_M,
  avaliarTagLivre,
  avaliarTagVinculada,
  distanciaMetros,
} from './portao-localizacao';

const T0 = new Date('2026-09-16T15:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

/** Desloca uma coordenada `m` metros para o norte (1° de latitude ≈ 111.195 m). */
const norte = (lat: number, m: number) => lat + m / 111_195;

const LAT = -22.714616;
const LNG = -43.378271;

describe('distanciaMetros', () => {
  it('mede 0 para o mesmo ponto e ~1 km para 1 km ao norte', () => {
    expect(distanciaMetros(LAT, LNG, LAT, LNG)).toBe(0);
    expect(distanciaMetros(LAT, LNG, norte(LAT, 1000), LNG)).toBeCloseTo(1000, -1);
  });
});

describe('avaliarTagVinculada', () => {
  const ref = [{ lat: LAT, lng: LNG, em: T0, fonte: 'RDV_RASTREADOR' as const }];

  it('CONFIRMADA quando a TAG está junto do rastreador no mesmo momento (caso real RMX4D35, 2–17 m)', () => {
    const r = avaliarTagVinculada(
      [{ lat: norte(LAT, 17), lng: LNG, accuracyM: 98, seenAt: min(3) }],
      ref,
    );
    expect(r.veredito).toBe('CONFIRMADA');
    expect(r.provas[0]).toMatchObject({ resultado: 'BATE' });
  });

  it('usa a precisão do ponto + 300 m como tolerância, e o limite é inclusivo', () => {
    const noLimite = avaliarTagVinculada(
      [{ lat: norte(LAT, 100 + FOLGA_RASTREADOR_M - 1), lng: LNG, accuracyM: 100, seenAt: T0 }],
      ref,
    );
    expect(noLimite.veredito).toBe('CONFIRMADA');
    const fora = avaliarTagVinculada(
      [{ lat: norte(LAT, 100 + FOLGA_RASTREADOR_M + 50), lng: LNG, accuracyM: 100, seenAt: T0 }],
      ref,
    );
    expect(fora.veredito).toBe('AGUARDANDO_PROVA');
  });

  it('sem precisão informada, considera 50 m', () => {
    const r = avaliarTagVinculada(
      [{ lat: norte(LAT, 50 + FOLGA_RASTREADOR_M + 30), lng: LNG, accuracyM: null, seenAt: T0 }],
      ref,
    );
    expect(r.veredito).toBe('AGUARDANDO_PROVA');
  });

  it('não compara pontos com mais de 10 min de diferença', () => {
    const r = avaliarTagVinculada(
      [{ lat: LAT, lng: LNG, accuracyM: 10, seenAt: new Date(T0.getTime() + DT_COMPARAVEL_MS + 1000) }],
      ref,
    );
    expect(r.veredito).toBe('AGUARDANDO_PROVA');
    expect(r.provas).toHaveLength(0);
  });

  it('DIVERGENTE quando, no mesmo momento, a TAG está a mais de 2 km do carro', () => {
    const r = avaliarTagVinculada(
      [{ lat: norte(LAT, CONTRADICAO_M + 100), lng: LNG, accuracyM: 20, seenAt: min(2) }],
      ref,
    );
    expect(r.veredito).toBe('DIVERGENTE');
  });

  it('contradição vence confirmação', () => {
    const r = avaliarTagVinculada(
      [
        { lat: LAT, lng: LNG, accuracyM: 20, seenAt: min(1) },
        { lat: norte(LAT, 5000), lng: LNG, accuracyM: 20, seenAt: min(40) },
      ],
      [...ref, { lat: LAT, lng: LNG, em: min(41), fonte: 'TRACCAR' as const }],
    );
    expect(r.veredito).toBe('DIVERGENTE');
  });

  it('AGUARDANDO_PROVA sem avistamento ou sem referência', () => {
    expect(avaliarTagVinculada([], ref).veredito).toBe('AGUARDANDO_PROVA');
    expect(
      avaliarTagVinculada([{ lat: LAT, lng: LNG, accuracyM: 5, seenAt: T0 }], []).veredito,
    ).toBe('AGUARDANDO_PROVA');
  });
});

describe('avaliarTagLivre', () => {
  it('ESTOQUE sem nenhum avistamento', () => {
    expect(avaliarTagLivre([]).veredito).toBe('ESTOQUE');
  });

  it('ESTOQUE quando todos os pontos ficam dentro de 1 km', () => {
    const r = avaliarTagLivre([
      { lat: LAT, lng: LNG, accuracyM: 20, seenAt: T0 },
      { lat: norte(LAT, RAIO_PARADA_M - 10), lng: LNG, accuracyM: 20, seenAt: min(60) },
    ]);
    expect(r.veredito).toBe('ESTOQUE');
  });

  it('LIVRE_EM_MOVIMENTO quando anda mais de 1 km — nunca vai para o estoque', () => {
    const r = avaliarTagLivre([
      { lat: LAT, lng: LNG, accuracyM: 20, seenAt: T0 },
      { lat: norte(LAT, 8000), lng: LNG, accuracyM: 20, seenAt: min(60) },
    ]);
    expect(r.veredito).toBe('LIVRE_EM_MOVIMENTO');
    expect(r.maiorDistanciaM).toBeGreaterThan(RAIO_PARADA_M);
  });
});
