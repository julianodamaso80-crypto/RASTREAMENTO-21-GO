/**
 * `tipo` do SGA → tipo do veículo no nosso cadastro.
 *
 * Existe porque `Vehicle.vehicleType` nasce com o default `CAR` e ninguém
 * preenchia: em 01/09/2026 eram 401 de 403 marcados como carro, com moto
 * dentro (CG 160 TITAN, PCX 160, ADV 160, BMW G 310). No mapa isso vira
 * desenho de carro em cima de uma moto e o texto "Carro ligado" — o painel
 * afirmando o que não é.
 *
 * Os 20 rótulos que o SGA usa de verdade, contados no espelho em 01/09/2026:
 *
 *   moto  → MOTOCICLETA (ATé 400CC) 12.781 · MOTOCICLETA (450CC A 1000CC) 423 ·
 *           MOTO ATÉ 400CC 70 · MOTOCICLETA (ATé 400CC) PLANO MULHER 8 ·
 *           MOTO 450CC A 1000CC 3 · MOTOCICLETA (450CC A 1000CC) PLANO MULHER 1
 *   carro → VEICULOS LEVES 18.273 · VEICULOS UTILITARIOS - SUV 3.573 ·
 *           VEíCULO LEVE VIP 1.242 · VEíCULO LEVE VIP APLICATIVO 256 ·
 *           CARRO VIP 219 · VEÍCULO LEVE BÁSICO 203 · CARRO VIP UBER/99 99 ·
 *           VEICULO LEVE PLANO MULHER 89 · VEíCULO LEVE BáSICO APLICATIVO 79 ·
 *           CARRO BÁSICO 48 · CARRO BÁSICO UBER/99 35 ·
 *           VEíCULO LEVE PLANO MULHER APLICATIVO 1
 *   nada  → MONITORAMENTO 227 · ROUBO E FURTO 15  (são planos, não dizem o
 *           tipo do veículo — quem decide nesses é o chassi)
 *
 * Uma versão anterior desta função só reconhecia "MOTOCICL" e mandava todo o
 * resto para `CAR`: "MOTO ATÉ 400CC" virava carro, e "MONITORAMENTO" também.
 * Por isso a lista acima está inteira aqui, e por isso rótulo desconhecido
 * devolve `null` em vez de cair no carro por omissão — inventar o tipo é
 * exatamente o que não pode acontecer.
 *
 * `null` também quando o SGA não diz nada: sem informação não se sobrescreve o
 * que já está no cadastro (o operador pode ter corrigido na mão).
 */
export function tipoVeiculoDoSga(
  tipo?: string | null,
): 'CAR' | 'MOTORCYCLE' | null {
  const texto = (tipo ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .trim();
  if (!texto) return null;
  if (/^MOTO|MOTOCICL|MOTONETA|CICLOMOTOR|SCOOTER/.test(texto)) {
    return 'MOTORCYCLE';
  }
  if (/VEICULO|CARRO|UTILITARIO|CAMIONET|PICKUP|CAMINHONET/.test(texto)) {
    return 'CAR';
  }
  return null;
}

/**
 * Segunda fonte: os três primeiros caracteres do chassi (WMI), que identificam
 * a fábrica que montou o veículo.
 *
 * A tabela abaixo NÃO é palpite: saiu de contagem sobre os 37.608 veículos do
 * espelho do SGA em 01/09/2026, e só entrou WMI com pelo menos 100 registros e
 * pelo menos 99% dos casos de um lado só. Fora dessa lista a resposta é `null`
 * — WMI desconhecido não vira chute.
 *
 *   moto  → 99H (244 / 100%) · 9C2 (8.860 / 99,3%) · 9C6 (3.720 / 99,1%)
 *   carro → 9BG 4.140 · 9BD 3.978 · 9BW 3.380 · 93Y 2.579 · 9BF 1.427 ·
 *           9BH 1.175 · 93H 1.025 · 9BR 932 · 94D 790 · 8AP 704 · 988 632 ·
 *           LC0 559 · 935 455 · 3N1 340 · KNA 225 · 936 221 · 8AG 178 ·
 *           KMH 171 · 8AD 164 · 95P 162 · 8A1 107  (todos ≤0,2% de moto)
 *
 * Para conferir de novo, ver `scripts/diagnostics/wmi-chassi.sql`.
 */
const WMI_MOTO = new Set(['99H', '9C2', '9C6']);
const WMI_CARRO = new Set([
  '9BG', '9BD', '9BW', '93Y', '9BF', '9BH', '93H', '9BR', '94D', '8AP',
  '988', 'LC0', '935', '3N1', 'KNA', '936', '8AG', 'KMH', '8AD', '95P',
  '8A1',
]);

export function tipoVeiculoPeloChassi(
  chassi?: string | null,
): 'CAR' | 'MOTORCYCLE' | null {
  const wmi = (chassi ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3);
  if (wmi.length < 3) return null;
  if (WMI_MOTO.has(wmi)) return 'MOTORCYCLE';
  if (WMI_CARRO.has(wmi)) return 'CAR';
  return null;
}

/**
 * Decisão final de carro x moto, com as duas fontes na mesa.
 *
 * Regras, nesta ordem:
 *  1. O SGA manda — é o cadastro do veículo, o mesmo que a operação usa.
 *  2. SGA calado (veículo fora do espelho, ou tipo em branco): decide o chassi.
 *     Antes disso o veículo caía no default `CAR`, ou seja, moto virava carro
 *     em silêncio.
 *  3. Nenhuma das duas sabe: devolve `null` e NADA é gravado — o cadastro fica
 *     como está, inclusive uma correção feita na mão.
 *
 * Quando as duas fontes se contradizem, a divergência é DEVOLVIDA para quem
 * chamou registrar, em vez de ser resolvida no chute: as duas erram em casos
 * medidos — o SGA classificou 65 chassis 9C2 (moto Honda) como veículo leve, e
 * a placa RJZ5I29 é uma CG 160 FAN com chassi digitado como 93H (carro).
 * Escolher sozinho ali seria exatamente o palpite que não pode existir.
 */
export function decidirTipoVeiculo(entrada: {
  tipoSga?: string | null;
  chassi?: string | null;
}): {
  tipo: 'CAR' | 'MOTORCYCLE' | null;
  divergencia: boolean;
} {
  const doSga = tipoVeiculoDoSga(entrada.tipoSga);
  const doChassi = tipoVeiculoPeloChassi(entrada.chassi);
  return {
    tipo: doSga ?? doChassi,
    divergencia: doSga !== null && doChassi !== null && doSga !== doChassi,
  };
}
