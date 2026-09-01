import {
  decidirTipoVeiculo,
  tipoVeiculoDoSga,
  tipoVeiculoPeloChassi,
} from './tipo-veiculo';

/**
 * Os rótulos abaixo são os que o SGA devolve de verdade — contados em
 * `installation_pendings` no dia 01/09/2026, com acento e caixa exatamente
 * como chegam.
 */
describe('tipoVeiculoDoSga', () => {
  it('classifica como MOTORCYCLE os 6 rótulos de moto do SGA', () => {
    for (const rotulo of [
      'MOTOCICLETA (ATé 400CC)',
      'MOTOCICLETA (450CC A 1000CC)',
      'MOTO ATÉ 400CC',
      'MOTO 450CC A 1000CC',
      'MOTOCICLETA (ATé 400CC) PLANO MULHER',
      'MOTOCICLETA (450CC A 1000CC) PLANO MULHER',
    ]) {
      expect(tipoVeiculoDoSga(rotulo)).toBe('MOTORCYCLE');
    }
  });

  it('classifica como CAR os 12 rótulos de carro do SGA', () => {
    for (const rotulo of [
      'VEICULOS LEVES',
      'VEICULOS UTILITARIOS - SUV',
      'VEíCULO LEVE VIP',
      'VEíCULO LEVE VIP APLICATIVO',
      'CARRO VIP',
      'VEÍCULO LEVE BÁSICO',
      'CARRO VIP UBER/99',
      'VEICULO LEVE PLANO MULHER',
      'VEíCULO LEVE BáSICO APLICATIVO',
      'CARRO BÁSICO',
      'CARRO BÁSICO UBER/99',
      'VEíCULO LEVE PLANO MULHER APLICATIVO',
    ]) {
      expect(tipoVeiculoDoSga(rotulo)).toBe('CAR');
    }
  });

  it('rótulo que não diz o tipo devolve null, em vez de virar carro', () => {
    // São planos, não categorias de veículo — moto e carro entram nos dois.
    expect(tipoVeiculoDoSga('MONITORAMENTO')).toBeNull();
    expect(tipoVeiculoDoSga('ROUBO E FURTO')).toBeNull();
    expect(tipoVeiculoDoSga('CATEGORIA NOVA QUE O SGA INVENTAR')).toBeNull();
  });

  it('devolve null sem informação, pra não sobrescrever o cadastro', () => {
    expect(tipoVeiculoDoSga(null)).toBeNull();
    expect(tipoVeiculoDoSga(undefined)).toBeNull();
    expect(tipoVeiculoDoSga('   ')).toBeNull();
  });
});

/**
 * Os WMIs abaixo são os medidos no espelho do SGA em 01/09/2026 (ver
 * scripts/diagnostics/wmi-chassi.sql). Chassi de exemplo tirado de veículo
 * real do parque.
 */
describe('tipoVeiculoPeloChassi', () => {
  it('reconhece fábrica de moto', () => {
    expect(tipoVeiculoPeloChassi('9C2KC2210TR087437')).toBe('MOTORCYCLE'); // CG 160 TITAN
    expect(tipoVeiculoPeloChassi('9C6KE1970PR012345')).toBe('MOTORCYCLE'); // Yamaha
  });

  it('reconhece fábrica de carro', () => {
    expect(tipoVeiculoPeloChassi('93HFC2660LZ100227')).toBe('CAR'); // Honda Civic
    expect(tipoVeiculoPeloChassi('9BGKS48R0KG123456')).toBe('CAR'); // GM
  });

  it('WMI fora da lista medida não vira chute', () => {
    expect(tipoVeiculoPeloChassi('93XSTGK1WNCM02140')).toBeNull(); // Mitsubishi
    expect(tipoVeiculoPeloChassi('ZZZ1234567890')).toBeNull();
    expect(tipoVeiculoPeloChassi('')).toBeNull();
    expect(tipoVeiculoPeloChassi(null)).toBeNull();
  });
});

describe('decidirTipoVeiculo', () => {
  it('o SGA manda quando ele sabe', () => {
    expect(
      decidirTipoVeiculo({
        tipoSga: 'MOTOCICLETA (ATé 400CC)',
        chassi: '9C2KC2210TR087437',
      }),
    ).toEqual({ tipo: 'MOTORCYCLE', divergencia: false });
  });

  it('SGA calado: o chassi decide, em vez de assumir carro', () => {
    expect(decidirTipoVeiculo({ tipoSga: null, chassi: '9C2KC2210TR087437' })).toEqual(
      { tipo: 'MOTORCYCLE', divergencia: false },
    );
  });

  it('as duas caladas: não grava nada', () => {
    expect(decidirTipoVeiculo({ tipoSga: null, chassi: null })).toEqual({
      tipo: null,
      divergencia: false,
    });
  });

  it('fontes em conflito: fica o SGA e a divergência é sinalizada', () => {
    // Caso real: RJZ5I29 é uma CG 160 FAN com o chassi digitado como 93H.
    expect(
      decidirTipoVeiculo({
        tipoSga: 'MOTOCICLETA (ATé 400CC)',
        chassi: '93HRV2870MK235049',
      }),
    ).toEqual({ tipo: 'MOTORCYCLE', divergencia: true });
  });
});
