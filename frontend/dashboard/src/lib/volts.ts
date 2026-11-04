/**
 * Tensão do veículo a partir dos atributos da posição do Traccar — mesmas
 * chaves e mesma regra do backend (`extrairVolts`). O gt06/J16 manda em
 * `adc1`; 0 é "não mediu", e acima de 100 é milivolt.
 */
const CHAVES_VOLTAGEM = [
  'power',
  'powerVoltage',
  'batteryVoltage',
  'externalPower',
  'externalPowerVoltage',
  'adc1',
] as const;

export function extrairVolts(attrs: Record<string, unknown> | undefined): number | null {
  if (!attrs) return null;
  for (const chave of CHAVES_VOLTAGEM) {
    const bruto = attrs[chave];
    if (typeof bruto !== 'number' || !Number.isFinite(bruto) || bruto <= 0) continue;
    const volts = bruto > 100 ? bruto / 1000 : bruto;
    return Math.round(volts * 100) / 100;
  }
  return null;
}
