import type { Vehicle } from '@/types/vehicle';

/**
 * Busca única da lista de veículos.
 *
 * Quem procura um veículo raramente tem a placa na mão: tem o nome de quem
 * ligou, o CPF que apareceu no atendimento ou o IMEI escrito na caixa do
 * rastreador. Buscar só por placa e modelo obrigava a descobrir a placa antes
 * de poder procurar.
 *
 * Regras:
 * - acento não atrapalha ("patricia" acha "PATRÍCIA");
 * - pontuação não atrapalha ("123.456.789-01" acha o CPF gravado sem máscara);
 * - várias palavras se somam ("ana silva" acha "ANA CAROLINE ... DA SILVA"),
 *   cada uma podendo casar num campo diferente.
 */

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Tudo que é procurável num veículo, junto num texto só. */
function camposDoVeiculo(v: Vehicle): string {
  return normalizar(
    [
      v.plate,
      v.brand,
      v.model,
      v.color,
      v.year,
      v.chassi,
      v.renavam,
      v.device?.imei,
      v.uniqueId,
      v.device?.installLocation,
      v.associate?.name,
      v.associate?.cpf,
      v.associate?.phone,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

export function matchesVehicleSearch(v: Vehicle, query: string): boolean {
  const termos = normalizar(query).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return true;

  const texto = camposDoVeiculo(v);
  // Versão só com dígitos, pra CPF/CNPJ, IMEI e telefone acharem mesmo quando
  // o usuário digita (ou copia) com ponto, traço ou parêntese.
  const digitos = texto.replace(/\D/g, '');

  return termos.every((termo) => {
    if (texto.includes(termo)) return true;
    const soDigitos = termo.replace(/\D/g, '');
    return soDigitos.length > 0 && digitos.includes(soDigitos);
  });
}
