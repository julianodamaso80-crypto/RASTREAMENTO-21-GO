import { tipoVeiculoDoSga } from './tipo-veiculo';

/**
 * Os rótulos abaixo são os que o SGA devolve de verdade — contados em
 * `installation_pendings` no dia 01/09/2026, com acento e caixa exatamente
 * como chegam.
 */
describe('tipoVeiculoDoSga', () => {
  it('classifica moto como MOTORCYCLE', () => {
    expect(tipoVeiculoDoSga('MOTOCICLETA (ATé 400CC)')).toBe('MOTORCYCLE');
    expect(tipoVeiculoDoSga('MOTOCICLETA (450CC A 1000CC)')).toBe('MOTORCYCLE');
  });

  it('classifica o resto do parque como CAR', () => {
    expect(tipoVeiculoDoSga('VEICULOS LEVES')).toBe('CAR');
    expect(tipoVeiculoDoSga('VEICULOS UTILITARIOS - SUV')).toBe('CAR');
    expect(tipoVeiculoDoSga('VEíCULO LEVE VIP')).toBe('CAR');
    expect(tipoVeiculoDoSga('MONITORAMENTO')).toBe('CAR');
  });

  it('não confunde MONITORAMENTO com moto', () => {
    // O prefixo "MO" é o mesmo; o que decide é MOTOCICL/MOTONETA/etc.
    expect(tipoVeiculoDoSga('MONITORAMENTO')).not.toBe('MOTORCYCLE');
  });

  it('devolve null sem informação, pra não sobrescrever o cadastro', () => {
    expect(tipoVeiculoDoSga(null)).toBeNull();
    expect(tipoVeiculoDoSga(undefined)).toBeNull();
    expect(tipoVeiculoDoSga('   ')).toBeNull();
  });
});
