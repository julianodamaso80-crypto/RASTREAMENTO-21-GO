import {
  decidirModo,
  INTERVALO_IDLE_S,
  INTERVALO_TURBO_S,
  BACKFILL_TURBO_H,
} from './polling-mode';

const AGORA = new Date('2026-08-20T12:00:00.000Z');

describe('decidirModo', () => {
  it('fica em IDLE quando nada aconteceu', () => {
    const r = decidirModo({ alertasAbertos: [], turboUntil: null, agora: AGORA });
    expect(r.modo).toBe('IDLE');
    expect(r.intervalSeconds).toBe(INTERVALO_IDLE_S);
    expect(r.backfillHours).toBe(0);
  });

  it.each(['OFFLINE', 'GPS_SILENT', 'JAMMING', 'POWER_CUT'])(
    'acelera quando o rastreador do veiculo esta com alerta %s',
    (alerta) => {
      const r = decidirModo({
        alertasAbertos: [alerta],
        turboUntil: null,
        agora: AGORA,
      });
      expect(r.modo).toBe('TURBO');
      expect(r.intervalSeconds).toBe(INTERVALO_TURBO_S);
      expect(r.backfillHours).toBe(BACKFILL_TURBO_H);
    },
  );

  it('nao acelera por alerta que nao indica rastreador neutralizado', () => {
    const r = decidirModo({
      alertasAbertos: ['SPEED', 'IGNITION_ON', 'MAINTENANCE_DUE'],
      turboUntil: null,
      agora: AGORA,
    });
    expect(r.modo).toBe('IDLE');
  });

  it('acelera por acionamento manual ainda valido', () => {
    const r = decidirModo({
      alertasAbertos: [],
      turboUntil: new Date('2026-08-20T12:00:01.000Z'),
      agora: AGORA,
    });
    expect(r.modo).toBe('TURBO');
  });

  it('volta a IDLE quando o acionamento manual expirou', () => {
    const r = decidirModo({
      alertasAbertos: [],
      turboUntil: new Date('2026-08-20T11:59:59.000Z'),
      agora: AGORA,
    });
    expect(r.modo).toBe('IDLE');
  });
});
