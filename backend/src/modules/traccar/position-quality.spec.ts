import {
  assessPosition,
  distanceMeters,
  isTrustworthyPosition,
} from './position-quality';

const AGORA = Date.parse('2026-08-10T12:00:00.000Z');

/** Posição boa de referência — Campo Grande, RJ. */
function posicaoBoa(over: Record<string, unknown> = {}) {
  return {
    latitude: -22.9,
    longitude: -43.55,
    valid: true,
    outdated: false,
    accuracy: 8,
    attributes: {},
    fixTime: '2026-08-10T11:59:00.000Z',
    ...over,
  } as any;
}

describe('assessPosition', () => {
  it('aprova posição com fix válido e recente', () => {
    expect(assessPosition(posicaoBoa(), AGORA)).toEqual({ trustworthy: true });
  });

  it('reprova posição marcada como inválida pelo Traccar', () => {
    const r = assessPosition(posicaoBoa({ valid: false }), AGORA);
    expect(r).toEqual({ trustworthy: false, reason: 'invalid' });
  });

  it('reprova posição outdated (reemissão de estado antigo)', () => {
    const r = assessPosition(posicaoBoa({ outdated: true }), AGORA);
    expect(r.trustworthy).toBe(false);
    expect(r.reason).toBe('outdated');
  });

  it('reprova LBS marcado em attributes.approximate', () => {
    const r = assessPosition(
      posicaoBoa({ attributes: { approximate: true } }),
      AGORA,
    );
    expect(r.reason).toBe('approximate');
  });

  it('reprova LBS marcado em attributes.lbs', () => {
    const r = assessPosition(posicaoBoa({ attributes: { lbs: true } }), AGORA);
    expect(r.reason).toBe('approximate');
  });

  it('reprova 0,0 (rastreador sem fix mandando zero)', () => {
    const r = assessPosition(posicaoBoa({ latitude: 0, longitude: 0 }), AGORA);
    expect(r.reason).toBe('null-island');
  });

  it('reprova coordenada fora de faixa', () => {
    expect(assessPosition(posicaoBoa({ latitude: 200 }), AGORA).reason).toBe(
      'out-of-range',
    );
  });

  it('reprova precisão pior que 1km (típico de torre de celular)', () => {
    const r = assessPosition(posicaoBoa({ accuracy: 3500 }), AGORA);
    expect(r.reason).toBe('bad-accuracy');
  });

  it('aceita precisão ausente (protocolo que não reporta accuracy)', () => {
    expect(
      isTrustworthyPosition(posicaoBoa({ accuracy: undefined }), AGORA),
    ).toBe(true);
  });

  it('reprova fix muito no futuro (relógio do rastreador errado)', () => {
    const r = assessPosition(
      posicaoBoa({ fixTime: '2026-08-11T12:00:00.000Z' }),
      AGORA,
    );
    expect(r.reason).toBe('future-fix');
  });

  it('aceita fix antigo — velho não é o mesmo que falso', () => {
    // Posição de 3h atrás continua sendo onde o veículo esteve de verdade.
    // Quem decide "fresco o bastante" é a UI, não este juiz.
    expect(
      isTrustworthyPosition(
        posicaoBoa({ fixTime: '2026-08-10T09:00:00.000Z' }),
        AGORA,
      ),
    ).toBe(true);
  });

  it('usa deviceTime quando não há fixTime', () => {
    const r = assessPosition(
      posicaoBoa({ fixTime: undefined, deviceTime: '2026-08-11T12:00:00.000Z' }),
      AGORA,
    );
    expect(r.reason).toBe('future-fix');
  });
});

describe('distanceMeters', () => {
  it('mede zero pra mesmo ponto', () => {
    expect(distanceMeters({ lat: -22.9, lng: -43.55 }, { lat: -22.9, lng: -43.55 })).toBe(0);
  });

  it('mede ~111km por grau de latitude', () => {
    const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('detecta rastreador longe do técnico (500m+)', () => {
    // ~0,009 grau de latitude ≈ 1km
    const d = distanceMeters(
      { lat: -22.9, lng: -43.55 },
      { lat: -22.909, lng: -43.55 },
    );
    expect(d).toBeGreaterThan(900);
    expect(d).toBeLessThan(1100);
  });
});
