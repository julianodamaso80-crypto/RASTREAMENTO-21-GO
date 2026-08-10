import { RELOCK_AFTER_MS, shouldRelock } from './biometrics';

describe('shouldRelock', () => {
  const agora = 1_000_000_000;

  it('sem registro de atividade, bloqueia', () => {
    expect(shouldRelock(null, agora)).toBe(true);
  });

  it('voltou em menos de 5 minutos: não pede de novo', () => {
    expect(shouldRelock(agora - 60_000, agora)).toBe(false);
  });

  it('voltou depois de 5 minutos: pede biometria', () => {
    expect(shouldRelock(agora - RELOCK_AFTER_MS - 1, agora)).toBe(true);
  });

  it('exatamente no limite ainda não pede', () => {
    expect(shouldRelock(agora - RELOCK_AFTER_MS, agora)).toBe(false);
  });
});
