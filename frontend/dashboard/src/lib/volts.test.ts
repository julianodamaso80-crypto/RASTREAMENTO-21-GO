import { extrairVolts } from './volts';

describe('extrairVolts', () => {
  it('lê a tensão do gt06/J16 em adc1', () => {
    expect(extrairVolts({ adc1: 12.63 })).toBe(12.63);
  });
  it('adc1 zerado é "não mediu"', () => {
    expect(extrairVolts({ adc1: 0 })).toBeNull();
    expect(extrairVolts(undefined)).toBeNull();
  });
  it('milivolt vira volt', () => {
    expect(extrairVolts({ power: 12630 })).toBe(12.63);
  });
});
