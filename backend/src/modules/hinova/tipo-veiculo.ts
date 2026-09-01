/**
 * `tipo` do SGA → tipo do veículo no nosso cadastro.
 *
 * Existe porque `Vehicle.vehicleType` nasce com o default `CAR` e ninguém
 * preenchia: em 01/09/2026 eram 401 de 403 marcados como carro, com moto
 * dentro (CG 160 TITAN, PCX 160, ADV 160, BMW G 310). No mapa isso vira
 * desenho de carro em cima de uma moto e o texto "Carro ligado" — o painel
 * afirmando o que não é.
 *
 * O SGA já classifica: "MOTOCICLETA (ATé 400CC)", "MOTOCICLETA (450CC A
 * 1000CC)", "VEICULOS LEVES", "VEICULOS UTILITARIOS - SUV", "VEíCULO LEVE
 * VIP", "MONITORAMENTO" (medidos na base em 01/09/2026). É essa a fonte —
 * adivinhar pelo nome do modelo erraria em todo lançamento novo.
 *
 * Devolve `null` quando o SGA não diz nada: sem informação não se sobrescreve
 * o que já está no cadastro (o operador pode ter corrigido na mão).
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
  return /MOTOCICL|MOTONETA|CICLOMOTOR|SCOOTER/.test(texto)
    ? 'MOTORCYCLE'
    : 'CAR';
}
