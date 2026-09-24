import { blockState } from './vehicle-visual';
import type { Vehicle } from './api';

function veiculo(status: string, blocked: boolean | null | undefined): Vehicle {
  return {
    id: 'v1',
    plate: 'TUM2F03',
    vehicleType: 'MOTORCYCLE',
    brand: null,
    model: null,
    color: null,
    year: null,
    status,
    traccarDeviceId: 1457,
    connection: null,
    position:
      blocked === undefined
        ? null
        : ({ latitude: 0, longitude: 0, blocked } as Vehicle['position']),
  };
}

describe('blockState — o rastreador manda', () => {
  it('rastreador confirmou e o comando foi bloquear → Bloqueado', () => {
    expect(blockState(veiculo('BLOCKED', true))).toBe('BLOQUEADO');
  });
  it('comando saiu mas o rastreador ainda diz que não → aguardando', () => {
    expect(blockState(veiculo('BLOCKED', false))).toBe('BLOQUEIO_PENDENTE');
  });
  it('pediu desbloqueio e o rastreador ainda está bloqueado → aguardando', () => {
    expect(blockState(veiculo('ACTIVE', true))).toBe('DESBLOQUEIO_PENDENTE');
  });
  it('pacote sem a informação do relé não vira desbloqueado', () => {
    expect(blockState(veiculo('BLOCKED', null))).toBe('BLOQUEADO');
  });
  it('sem posição, vale o que o sistema gravou', () => {
    expect(blockState(veiculo('BLOCKED', undefined))).toBe('BLOQUEADO');
  });
  it('normal → sem estado de bloqueio', () => {
    expect(blockState(veiculo('ACTIVE', false))).toBeNull();
    expect(blockState(veiculo('ACTIVE', null))).toBeNull();
  });
});
