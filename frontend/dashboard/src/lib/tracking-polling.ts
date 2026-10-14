import type { TraccarDevice, TraccarPosition } from '@/types/traccar';

export type ModoPolling = 'legado' | 'contingencia';

// Env de build: o Next embute o valor no bundle. Ausente = legado (o de hoje).
export const MODO_POLLING: ModoPolling =
  process.env.NEXT_PUBLIC_POLLING_MODE === 'contingencia' ? 'contingencia' : 'legado';

export const POLL_MS = 8_000;
export const RECONCILIA_MS = 60_000;
export const VEHICLES_MS = 32_000;
// Maior que pingInterval (25 s) + pingTimeout (20 s) do socket.io: o socket
// "conectado" sem nenhum lote nesse tempo é tratado como degradado.
export const SOCKET_MUDO_MS = 90_000;

export interface EstadoPolling {
  modo: ModoPolling;
  agora: number;
  /** Ciclos executados (aba visível, sem ciclo em andamento) — o contador do legado. */
  tique: number;
  socketConectado: boolean;
  ultimoLoteEm: number | null;
  ultimaFrotaEm: number;
  ultimosVehiclesEm: number;
}

// Meio tique de folga: o setInterval atrasa uns ms, e sem ela o prazo de 32 s
// (ou 60 s) escorregava ora para o tique seguinte, ora não.
const FOLGA_MS = POLL_MS / 2;

export function decidirPolling(e: EstadoPolling): {
  frota: boolean;
  vehicles: boolean;
  motivo: 'legado' | 'socket-fora' | 'socket-mudo' | 'reconciliacao' | 'nada';
} {
  if (e.modo === 'legado') {
    return { frota: true, vehicles: e.tique % 4 === 0, motivo: 'legado' };
  }
  const vehicles = e.agora - e.ultimosVehiclesEm >= VEHICLES_MS - FOLGA_MS;
  if (!e.socketConectado) return { frota: true, vehicles, motivo: 'socket-fora' };
  // Sem nenhum lote ainda (null) nunca conta como mudo: o teto, nesse caso, é
  // a reconciliação.
  if (e.ultimoLoteEm !== null && e.agora - e.ultimoLoteEm > SOCKET_MUDO_MS) {
    return { frota: true, vehicles, motivo: 'socket-mudo' };
  }
  if (e.agora - e.ultimaFrotaEm >= RECONCILIA_MS - FOLGA_MS) {
    return { frota: true, vehicles, motivo: 'reconciliacao' };
  }
  return { frota: false, vehicles, motivo: 'nada' };
}

function instante(valor: string | undefined): number {
  return valor ? Date.parse(valor) : NaN;
}

/** A anterior é estritamente mais nova que a nova? Empate fica com a nova. */
function posicaoAnteriorMaisNova(anterior: TraccarPosition, nova: TraccarPosition): boolean {
  for (const campo of ['serverTime', 'fixTime'] as const) {
    const a = instante(anterior[campo]);
    const n = instante(nova[campo]);
    if (!Number.isNaN(a) && !Number.isNaN(n) && a !== n) return a > n;
  }
  return anterior.id > nova.id;
}

/**
 * O conjunto é o da resposta HTTP (quem saiu, sai); para quem está nos dois,
 * fica a posição mais nova — o lote do WebSocket pode ter chegado depois do
 * snapshot que o HTTP montou.
 */
export function mesclarPosicoes(
  anterior: Map<number, TraccarPosition>,
  novas: TraccarPosition[],
): Map<number, TraccarPosition> {
  const resultado = new Map<number, TraccarPosition>();
  for (const nova of novas) {
    const atual = anterior.get(nova.deviceId);
    resultado.set(
      nova.deviceId,
      atual && posicaoAnteriorMaisNova(atual, nova) ? atual : nova,
    );
  }
  return resultado;
}

export function mesclarDevices(
  anterior: Map<number, TraccarDevice>,
  novos: TraccarDevice[],
): Map<number, TraccarDevice> {
  const resultado = new Map<number, TraccarDevice>();
  for (const novo of novos) {
    const atual = anterior.get(novo.id);
    const a = instante(atual?.lastUpdate);
    const n = instante(novo.lastUpdate);
    const ficaAtual = atual !== undefined && !Number.isNaN(a) && !Number.isNaN(n) && a > n;
    resultado.set(novo.id, ficaAtual ? atual : novo);
  }
  return resultado;
}

/** Item de `attrs:batch`: estado de uma posição reprovada pelo portão, sem coordenada. */
export interface AtributosItem {
  deviceId: number;
  serverTime: string;
  attributes: Record<string, unknown>;
}

/**
 * Posição exibida depois de um `attrs:batch`. O horário dos atributos fica num
 * campo à parte (fora do contrato do Traccar): se sobrescrevesse `serverTime`,
 * `mesclarPosicoes` passaria a recusar um snapshot REST com fix mais novo que o
 * socket perdeu, e o carro ficaria parado na coordenada velha.
 */
export type PosicaoComAtributos = TraccarPosition & { attributesServerTime?: string };

const ATRIBUTOS_LISTA_BRANCA = [
  'ignition',
  'power',
  'charge',
  'blocked',
  'batteryLevel',
  'sat',
  'motion',
  'powerCut',
  'jamming',
  'alarm',
] as const;

/**
 * Aplica ignição/energia/bloqueio de pacotes sem fix sobre a posição exibida.
 * Coordenada, fix, velocidade, rumo e `serverTime` ficam os da última posição
 * aprovada; item mais velho que ela (ou que os atributos já aplicados) é
 * ignorado; device sem posição não ganha entrada.
 */
export function aplicarAtributos(
  anterior: Map<number, TraccarPosition>,
  lote: AtributosItem[],
): Map<number, TraccarPosition> {
  let resultado: Map<number, TraccarPosition> | null = null;
  for (const item of lote) {
    const mapa: Map<number, TraccarPosition> = resultado ?? anterior;
    const atual: PosicaoComAtributos | undefined = mapa.get(item.deviceId);
    if (!atual) continue;
    const n = instante(item.serverTime);
    if (Number.isNaN(n)) continue;
    const maisVelho = [atual.serverTime, atual.attributesServerTime].some((v) => {
      const a = instante(v);
      return !Number.isNaN(a) && a > n;
    });
    if (maisVelho) continue;

    const filtrados: Record<string, unknown> = {};
    for (const chave of ATRIBUTOS_LISTA_BRANCA) {
      if (item.attributes?.[chave] !== undefined) filtrados[chave] = item.attributes[chave];
    }
    if (Object.keys(filtrados).length === 0) continue;

    if (!resultado) resultado = new Map(anterior);
    const nova: PosicaoComAtributos = {
      ...atual,
      attributesServerTime: item.serverTime,
      attributes: { ...atual.attributes, ...filtrados },
    };
    resultado.set(item.deviceId, nova);
  }
  return resultado ?? anterior;
}

/** CLIENT recebe 403 em /traccar/*; os veículos dele vêm de /vehicles/mine. */
export function devePedirFrotaHttp(role: string | undefined): boolean {
  return role !== 'CLIENT';
}
