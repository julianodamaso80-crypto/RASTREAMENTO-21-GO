import type { TraccarDevice, TraccarPosition } from '@/types/traccar';
import { criarCoalescedorDeLotes, type LoteTempoReal } from './coalescedor-lotes';
import type { AtributosItem } from './tracking-polling';

const p = (deviceId: number) => ({ deviceId }) as TraccarPosition;
const d = (id: number) => ({ id }) as TraccarDevice;
const a = (deviceId: number) => ({ deviceId, serverTime: '', attributes: {} }) as AtributosItem;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('criarCoalescedorDeLotes', () => {
  it('três eventos no mesmo tique viram um flush com os três', () => {
    const flush = jest.fn<void, [LoteTempoReal]>();
    const c = criarCoalescedorDeLotes(flush);
    c.positions([p(1)]);
    c.devices([d(1)]);
    c.atributos([a(1)]);
    expect(flush).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith({ positions: [p(1)], devices: [d(1)], atributos: [a(1)] });
  });

  it('eventos em tiques diferentes viram flushes separados', () => {
    const flush = jest.fn<void, [LoteTempoReal]>();
    const c = criarCoalescedorDeLotes(flush);
    c.positions([p(1)]);
    jest.runOnlyPendingTimers();
    c.devices([d(2)]);
    jest.runOnlyPendingTimers();
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenNthCalledWith(1, { positions: [p(1)], devices: [], atributos: [] });
    expect(flush).toHaveBeenNthCalledWith(2, { positions: [], devices: [d(2)], atributos: [] });
  });

  it('dois lotes do mesmo tipo no tique concatenam na ordem de chegada', () => {
    const flush = jest.fn<void, [LoteTempoReal]>();
    const c = criarCoalescedorDeLotes(flush);
    c.positions([p(1)]);
    c.positions([p(2), p(1)]);
    jest.runOnlyPendingTimers();
    expect(flush).toHaveBeenCalledWith({ positions: [p(1), p(2), p(1)], devices: [], atributos: [] });
  });

  it('cancelar descarta o pendente e não chama flush', () => {
    const flush = jest.fn<void, [LoteTempoReal]>();
    const c = criarCoalescedorDeLotes(flush);
    c.positions([p(1)]);
    c.cancelar();
    jest.runOnlyPendingTimers();
    expect(flush).not.toHaveBeenCalled();
  });
});
