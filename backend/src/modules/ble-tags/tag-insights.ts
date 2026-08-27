/**
 * Análise de padrão sobre avistamentos de TAG.
 *
 * Tudo aqui é função pura: entra lista de pontos, sai conclusão. Sem banco,
 * sem relógio implícito (quem precisa de "agora" recebe como argumento). É o
 * mesmo desenho de polling-mode.ts — a regra mora num arquivo testável e o
 * service só orquestra.
 *
 * O que estas funções PODEM afirmar é limitado pela natureza do dado: a TAG é
 * vista quando alguém passa perto, com atraso medido entre 8 e 47 min. Dá para
 * dizer "costuma ficar neste lugar nesta faixa de horário"; NÃO dá para dizer
 * "passou na rua X às 8h02". Quem consome isso precisa respeitar o limite.
 */

/**
 * O projeto ainda não tem fuso por tenant (nem por usuário). Enquanto não
 * tiver, toda leitura de "hora local" passa por aqui — trocar isto por um
 * lookup é a única mudança necessária no dia em que existir.
 */
export const TZ_OFFSET_HOURS = -3;

export interface PontoBruto {
  lat: number;
  lng: number;
  accuracy: number | null;
  seenAt: Date;
}

export interface Cluster {
  centroLat: number;
  centroLng: number;
  pontos: PontoBruto[];
  primeiraVez: Date;
  ultimaVez: Date;
  /** 24 posições: quantos avistamentos caíram em cada hora local. */
  porHora: number[];
}

export interface LocalHabitual {
  centroLat: number;
  centroLng: number;
  totalAvistamentos: number;
  diasDistintos: number;
  faixaHorariaTexto: string;
  participacaoPct: number;
}

export interface UltimaParada {
  centroLat: number;
  centroLng: number;
  /** Início da sequência final de avistamentos dentro do mesmo raio. */
  paradoDesde: Date;
  /** Falso quando o último avistamento já envelheceu — a TAG pode ter saído. */
  aindaLa: boolean;
  ultimoAvistamento: Date;
}

export interface Segmento {
  pontos: PontoBruto[];
}

export function horaLocal(d: Date): number {
  return (d.getUTCHours() + TZ_OFFSET_HOURS + 24) % 24;
}

export function distanciaMetros(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function ordenar(pontos: PontoBruto[]): PontoBruto[] {
  return [...pontos].sort((a, b) => a.seenAt.getTime() - b.seenAt.getTime());
}

/** Dia civil local do avistamento, no formato YYYY-MM-DD. */
function diaLocal(d: Date): string {
  return new Date(d.getTime() + TZ_OFFSET_HOURS * 3600000)
    .toISOString()
    .slice(0, 10);
}

function contarDiasDistintos(pontos: PontoBruto[]): number {
  return new Set(pontos.map((p) => diaLocal(p.seenAt))).size;
}

function faixaHoraria(porHora: number[]): string {
  const horas = porHora
    .map((n, h) => ({ n, h }))
    .filter((x) => x.n > 0)
    .map((x) => x.h);
  if (horas.length === 0) return '';
  const min = Math.min(...horas);
  const max = Math.max(...horas);
  const pad = (h: number) => `${String(h).padStart(2, '0')}h`;
  return min === max ? pad(min) : `${pad(min)}–${pad(max)}`;
}

/**
 * Agrupamento guloso por proximidade. O centro é recalculado como média
 * corrente a cada ponto absorvido — determinístico, já que a entrada é sempre
 * ordenada por tempo antes de começar.
 */
export function clusterizar(pontos: PontoBruto[], raioM = 150): Cluster[] {
  const clusters: Cluster[] = [];

  for (const p of ordenar(pontos)) {
    let alvo: Cluster | undefined;
    for (const c of clusters) {
      if (distanciaMetros(p.lat, p.lng, c.centroLat, c.centroLng) <= raioM) {
        alvo = c;
        break;
      }
    }

    if (!alvo) {
      alvo = {
        centroLat: p.lat,
        centroLng: p.lng,
        pontos: [],
        primeiraVez: p.seenAt,
        ultimaVez: p.seenAt,
        porHora: new Array(24).fill(0),
      };
      clusters.push(alvo);
    }

    alvo.pontos.push(p);
    const n = alvo.pontos.length;
    alvo.centroLat = (alvo.centroLat * (n - 1) + p.lat) / n;
    alvo.centroLng = (alvo.centroLng * (n - 1) + p.lng) / n;
    if (p.seenAt < alvo.primeiraVez) alvo.primeiraVez = p.seenAt;
    if (p.seenAt > alvo.ultimaVez) alvo.ultimaVez = p.seenAt;
    alvo.porHora[horaLocal(p.seenAt)]++;
  }

  return clusters;
}

export function detectarLocaisHabituais(
  pontos: PontoBruto[],
  opts: { minAvistamentos?: number } = {},
): LocalHabitual[] {
  const min = opts.minAvistamentos ?? 5;
  const total = pontos.length || 1;

  return clusterizar(pontos)
    .filter((c) => c.pontos.length >= min)
    .map((c) => ({
      centroLat: c.centroLat,
      centroLng: c.centroLng,
      totalAvistamentos: c.pontos.length,
      diasDistintos: contarDiasDistintos(c.pontos),
      faixaHorariaTexto: faixaHoraria(c.porHora),
      participacaoPct: Math.round((c.pontos.length / total) * 100),
    }))
    .sort((a, b) => b.totalAvistamentos - a.totalAvistamentos);
}

/**
 * Onde o veículo passa a noite. Exige dominância (metade dos avistamentos
 * noturnos no mesmo lugar) e repetição (três noites distintas) — sem isso a
 * conclusão seria chute, e chute sobre o endereço de alguém é grave.
 */
export function detectarPernoite(pontos: PontoBruto[]): LocalHabitual | null {
  const noturnos = pontos.filter((p) => {
    const h = horaLocal(p.seenAt);
    return h >= 22 || h < 5;
  });
  if (noturnos.length === 0) return null;

  const [top] = clusterizar(noturnos).sort(
    (a, b) => b.pontos.length - a.pontos.length,
  );
  if (!top) return null;

  const cobertura = top.pontos.length / noturnos.length;
  const noites = contarDiasDistintos(top.pontos);
  if (cobertura < 0.5 || noites < 3) return null;

  return {
    centroLat: top.centroLat,
    centroLng: top.centroLng,
    totalAvistamentos: top.pontos.length,
    diasDistintos: noites,
    faixaHorariaTexto: faixaHoraria(top.porHora),
    participacaoPct: Math.round(cobertura * 100),
  };
}

/**
 * Onde a TAG parou por último. "Parado" é a sequência final de avistamentos
 * contida no mesmo raio — andando para trás no tempo até o primeiro ponto que
 * cai fora dele.
 */
export function detectarUltimaParada(
  pontos: PontoBruto[],
  agora: Date,
  raioM = 150,
): UltimaParada | null {
  const ord = ordenar(pontos);
  if (ord.length === 0) return null;

  const ultimo = ord[ord.length - 1];
  let inicio = ord.length - 1;
  for (let i = ord.length - 2; i >= 0; i--) {
    if (
      distanciaMetros(ord[i].lat, ord[i].lng, ultimo.lat, ultimo.lng) <= raioM
    ) {
      inicio = i;
    } else {
      break;
    }
  }

  return {
    centroLat: ultimo.lat,
    centroLng: ultimo.lng,
    paradoDesde: ord[inicio].seenAt,
    // 30 min é o piso de consulta da rede Find My (ver polling-mode). Passou
    // disso sem novo avistamento, não dá mais para afirmar que continua lá.
    aindaLa: agora.getTime() - ultimo.seenAt.getTime() <= 30 * 60000,
    ultimoAvistamento: ultimo.seenAt,
  };
}

/**
 * Quebra a trilha nos buracos de sinal. Cada segmento vira uma linha própria
 * no mapa: ligar os dois lados de um buraco de horas afirmaria um trajeto que
 * ninguém observou.
 */
export function segmentar(pontos: PontoBruto[], gapMin = 30): Segmento[] {
  const ord = ordenar(pontos);
  const segmentos: Segmento[] = [];
  let atual: PontoBruto[] = [];

  for (const p of ord) {
    if (atual.length === 0) {
      atual.push(p);
      continue;
    }
    const anterior = atual[atual.length - 1];
    const gap = (p.seenAt.getTime() - anterior.seenAt.getTime()) / 60000;
    if (gap > gapMin) {
      segmentos.push({ pontos: atual });
      atual = [p];
    } else {
      atual.push(p);
    }
  }

  if (atual.length) segmentos.push({ pontos: atual });
  return segmentos;
}
