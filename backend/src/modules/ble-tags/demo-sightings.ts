/**
 * Gera a "história" de um veículo em avistamentos de TAG, de forma
 * determinística.
 *
 * Serve a dois donos: é a fixture dos testes de análise (tag-insights) e é o
 * que popula o banco de desenvolvimento para ver a tela funcionando sem
 * depender de TAG real na rua. Determinismo é requisito — nada de Math.random
 * nem Date.now aqui dentro, senão teste vira loteria.
 *
 * O perfil imita o que medimos em campo: a TAG é vista de tempos em tempos
 * (não continuamente), com raio de confiança de algumas dezenas de metros.
 */

/** Coordenadas reais do RJ zona oeste — a mesma região do parque hoje. */
export const CASA = { lat: -22.939, lng: -43.56 };
export const TRABALHO = { lat: -22.9812, lng: -43.5822 };

export interface DemoSighting {
  deviceId: string;
  tenantId: string;
  macAddress: string;
  accuracy: number;
  hashedAdvKey: string;
  seenAt: Date;
  scannerLat: number;
  scannerLng: number;
  scannerSource: string;
}

/**
 * Espalha o ponto num raio de ~11 m de forma determinística. Sem isso todos os
 * avistamentos cairiam na coordenada exata, o que não acontece na vida real e
 * esconderia bugs de clusterização.
 */
function jitter(base: number, seed: number): number {
  return base + (((seed * 37) % 20) - 10) / 100000;
}

/**
 * Janelas do dia: [horaLocalInício, horaLocalFim, lugar, passoEmMinutos].
 * As lacunas (06–08h e 17–18h) são os deslocamentos, quando a TAG passa mais
 * tempo sem ser vista — é o buraco que o mapa precisa saber desenhar.
 */
const JANELAS: Array<[number, number, typeof CASA, number]> = [
  [0, 6, CASA, 20],
  [8, 9, TRABALHO, 6],
  [9, 17, TRABALHO, 25],
  [18, 24, CASA, 20],
];

export function buildDemoSightings(
  deviceId: string,
  tenantId: string,
  baseDay: Date,
): DemoSighting[] {
  const out: DemoSighting[] = [];
  let seed = 1;

  for (let dia = 0; dia < 7; dia++) {
    for (const [horaInicio, horaFim, lugar, passoMin] of JANELAS) {
      for (let minuto = horaInicio * 60; minuto < horaFim * 60; minuto += passoMin) {
        const seenAt = new Date(
          baseDay.getTime() + dia * 86400000 + minuto * 60000,
        );
        seed++;
        out.push({
          deviceId,
          tenantId,
          macAddress: '0E:02:3C:02:25:EB',
          // 30–89 m: a faixa que a rede Find My costuma devolver.
          accuracy: 30 + (seed % 60),
          hashedAdvKey: `demo-${dia}-${minuto}`,
          seenAt,
          scannerLat: jitter(lugar.lat, seed),
          scannerLng: jitter(lugar.lng, seed + 5),
          scannerSource: 'seed-demo',
        });
      }
    }
  }

  return out;
}
