import { estadoRede, ignicaoRede, ultimaAtualizacao } from './estado-rede';

const AGORA = Date.parse('2026-10-07T15:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const antes = (ms: number) => new Date(AGORA - ms).toISOString();

function veiculo(o: { contato: number | null; tipo?: 'CAR' | 'MOTORCYCLE'; semPosicao?: boolean }) {
  return {
    vehicleType: o.tipo ?? 'CAR',
    connection: { status: 'offline', lastUpdate: o.contato == null ? null : antes(o.contato) },
    position: o.semPosicao ? null : { latitude: -22.95, longitude: -43.68, fixTime: antes(67 * H) },
  };
}

beforeAll(() => {
  jest.spyOn(Date, 'now').mockReturnValue(AGORA);
});
afterAll(() => {
  jest.restoreAllMocks();
});

describe('estadoRede — mesma régua da RedeVeiculos', () => {
  it('contato agora com GPS de 67 h (carro parado) é ONLINE', () => {
    expect(estadoRede(veiculo({ contato: 2 * MIN })).label).toBe('ONLINE');
  });
  it('48 min sem contato é S/RESP', () => {
    expect(estadoRede(veiculo({ contato: 48 * MIN })).label).toBe('S/RESP');
  });
  it('61 min sem contato é OFFLINE', () => {
    expect(estadoRede(veiculo({ contato: 61 * MIN })).label).toBe('OFFLINE');
  });
  it('falando sem posição GPS é S/GPS', () => {
    expect(estadoRede(veiculo({ contato: MIN, semPosicao: true })).label).toBe('S/GPS');
  });
  it('moto calada há 10 h é SLEEP; carro é OFFLINE', () => {
    expect(estadoRede(veiculo({ contato: 10 * H, tipo: 'MOTORCYCLE' })).label).toBe('SLEEP');
    expect(estadoRede(veiculo({ contato: 10 * H })).label).toBe('OFFLINE');
  });
  it('sem data de contato é OFFLINE', () => {
    expect(estadoRede(veiculo({ contato: null })).label).toBe('OFFLINE');
  });
  it('usa as cores da Rede', () => {
    expect(estadoRede(veiculo({ contato: MIN })).color).toBe('#1BCF28');
    expect(estadoRede(veiculo({ contato: 6 * 24 * H })).color).toBe('#E04006');
  });
});

describe('ignição e texto do card', () => {
  it('ignição só aparece com o rastreador conectado', () => {
    expect(ignicaoRede(estadoRede(veiculo({ contato: MIN })), true)).toBe('Ligada');
    expect(ignicaoRede(estadoRede(veiculo({ contato: 6 * 24 * H })), true)).toBe('--');
  });
  it('"Última atualização há 6 dias", como o card da Rede', () => {
    expect(ultimaAtualizacao(antes(6 * 24 * H))).toBe('Última atualização há 6 dias');
    expect(ultimaAtualizacao(antes(10 * MIN))).toBe('Última atualização há 10 minutos');
    expect(ultimaAtualizacao(null)).toBe('Última atualização não informada');
  });
});
