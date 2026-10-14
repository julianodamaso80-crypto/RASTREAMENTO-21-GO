import {
  ONLINE_ATE_MS,
  SEM_RESP_ATE_MS,
  SLEEP_MOTO_ATE_MS,
  STALE_POSITION_MS,
} from './constants';
import { proximaTransicaoEm } from './status-transicoes';
import { estaAndando, getDisplayStatus } from './utils';

const AGORA = Date.parse('2026-10-14T12:00:00.000Z');
const ha = (ms: number) => new Date(AGORA - ms).toISOString();
const MIN = 60_000;

describe('proximaTransicaoEm', () => {
  it('online com posição fresca: a próxima virada é a do movimento (3 min)', () => {
    const lu = ha(1 * MIN);
    expect(
      proximaTransicaoEm({ lastUpdate: lu, positionTime: lu, vehicleType: 'CAR', agora: AGORA }),
    ).toBe(Date.parse(lu) + STALE_POSITION_MS);
  });

  it('online com posição velha: vira S/RESP logo depois dos 30 min', () => {
    const lu = ha(10 * MIN);
    const t = proximaTransicaoEm({ lastUpdate: lu, positionTime: ha(20 * MIN), vehicleType: 'CAR', agora: AGORA });
    expect(t).toBe(Date.parse(lu) + ONLINE_ATE_MS + 1);
  });

  it('S/RESP: vira OFFLINE logo depois dos 60 min', () => {
    const lu = ha(45 * MIN);
    const t = proximaTransicaoEm({ lastUpdate: lu, positionTime: lu, vehicleType: 'CAR', agora: AGORA });
    expect(t).toBe(Date.parse(lu) + SEM_RESP_ATE_MS + 1);
  });

  it('S/GPS (sem posição): vira OFFLINE logo depois dos 60 min', () => {
    const lu = ha(5 * MIN);
    const t = proximaTransicaoEm({ lastUpdate: lu, positionTime: null, vehicleType: 'CAR', agora: AGORA });
    expect(t).toBe(Date.parse(lu) + SEM_RESP_ATE_MS + 1);
  });

  it('moto calada: SLEEP até 2 dias; carro calado: OFFLINE sem próxima virada', () => {
    const lu = ha(3 * 60 * MIN);
    expect(proximaTransicaoEm({ lastUpdate: lu, positionTime: lu, vehicleType: 'MOTORCYCLE', agora: AGORA })).toBe(
      Date.parse(lu) + SLEEP_MOTO_ATE_MS,
    );
    expect(proximaTransicaoEm({ lastUpdate: lu, positionTime: lu, vehicleType: 'CAR', agora: AGORA })).toBeNull();
  });

  it('sem contato nenhum: null', () => {
    expect(proximaTransicaoEm({ lastUpdate: '', positionTime: null, vehicleType: 'CAR', agora: AGORA })).toBeNull();
  });

  it('nos instantes devolvidos o status de fato muda (1 ms antes, não)', () => {
    jest.useFakeTimers();
    try {
      const lu = ha(10 * MIN);
      const base = { lastUpdate: lu, positionTime: lu, latitude: -22, longitude: -43, vehicleStatus: 'ACTIVE', vehicleType: 'CAR' as const };
      const t = proximaTransicaoEm({ lastUpdate: lu, positionTime: lu, vehicleType: 'CAR', agora: AGORA })!;
      jest.setSystemTime(t - 1);
      expect(getDisplayStatus(base)).toBe('online');
      jest.setSystemTime(t);
      expect(getDisplayStatus(base)).toBe('sem_resp');

      const pt = ha(1 * MIN);
      const tm = proximaTransicaoEm({ lastUpdate: pt, positionTime: pt, vehicleType: 'CAR', agora: AGORA })!;
      jest.setSystemTime(tm - 1);
      expect(estaAndando(30, pt)).toBe(true);
      jest.setSystemTime(tm);
      expect(estaAndando(30, pt)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
