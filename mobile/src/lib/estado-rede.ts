/**
 * Estado da comunicação do rastreador com a régua e os nomes da RedeVeiculos
 * (lidos no mapa /rastreamento/v2/ deles em 07/10/2026) — a mesma do painel
 * web (frontend/dashboard/src/lib/utils.ts → getDisplayStatus):
 *
 *  ONLINE  — comunicou há até 30 min                   verde
 *  S/RESP  — comunicou há 30–60 min                    amarelo
 *  S/GPS   — comunicando, mas sem nenhuma posição GPS  preto
 *  SLEEP   — moto calada há menos de 2 dias            azul
 *  OFFLINE — o resto                                   laranja
 *
 * "Comunicou" é o último sinal de vida (`connection.lastUpdate`, que anda com
 * o heartbeat), não a última posição GPS: carro parado mandando heartbeat
 * continua ONLINE. O `connection.status` do Traccar não entra — ele diz
 * "offline" toda vez que a conexão TCP fecha, e o GT06 fecha e reabre o tempo
 * todo. Nunca "defeito": OFFLINE com "Última atualização há X" é fato.
 */
export type EstadoKey = 'online' | 'sem_resp' | 'sem_gps' | 'sleep' | 'offline';

export interface Estado {
  key: EstadoKey;
  label: string;
  color: string;
  /** Rastreador falando com o servidor agora (na Rede: status_sinal = R). */
  conectado: boolean;
}

const ONLINE_ATE_MS = 30 * 60 * 1000;
const SEM_RESP_ATE_MS = 60 * 60 * 1000;
const SLEEP_MOTO_ATE_MS = 2 * 24 * 60 * 60 * 1000;

const ESTADOS: Record<EstadoKey, Estado> = {
  online: { key: 'online', label: 'ONLINE', color: '#1BCF28', conectado: true },
  sem_resp: { key: 'sem_resp', label: 'S/RESP', color: '#F5BE11', conectado: true },
  sem_gps: { key: 'sem_gps', label: 'S/GPS', color: '#000000', conectado: true },
  sleep: { key: 'sleep', label: 'SLEEP', color: '#3ABAF4', conectado: false },
  offline: { key: 'offline', label: 'OFFLINE', color: '#E04006', conectado: false },
};

export function estadoRede(v: {
  vehicleType?: string | null;
  connection: { lastUpdate: string | null } | null;
  position: { latitude: number; longitude: number; fixTime: string } | null;
}): Estado {
  const contato = v.connection?.lastUpdate;
  const idade = contato ? Date.now() - new Date(contato).getTime() : NaN;
  if (!Number.isFinite(idade)) return ESTADOS.offline;
  if (idade <= SEM_RESP_ATE_MS) {
    const p = v.position;
    const temPosicao = !!p && !!p.fixTime && !(p.latitude === 0 && p.longitude === 0);
    if (!temPosicao) return ESTADOS.sem_gps;
    return idade <= ONLINE_ATE_MS ? ESTADOS.online : ESTADOS.sem_resp;
  }
  if (v.vehicleType === 'MOTORCYCLE' && idade < SLEEP_MOTO_ATE_MS) return ESTADOS.sleep;
  return ESTADOS.offline;
}

/** Ignição como a Rede mostra: só com o rastreador conectado; senão "--". */
export function ignicaoRede(estado: Estado, ignition: boolean | null | undefined): string {
  if (!estado.conectado || ignition == null) return '--';
  return ignition ? 'Ligada' : 'Desligada';
}

/**
 * "Última atualização há 6 dias" — o texto do card da Rede, que usa
 * `moment().fromNow()` em pt-br. Mesmos degraus do moment.
 */
export function ultimaAtualizacao(iso: string | null | undefined): string {
  const s = iso ? (Date.now() - new Date(iso).getTime()) / 1000 : NaN;
  if (!Number.isFinite(s)) return 'Última atualização não informada';
  const m = s / 60;
  const h = m / 60;
  const d = h / 24;
  let txt: string;
  if (s < 45) txt = 'há poucos segundos';
  else if (s < 90) txt = 'há um minuto';
  else if (m < 45) txt = `há ${Math.round(m)} minutos`;
  else if (m < 90) txt = 'há uma hora';
  else if (h < 22) txt = `há ${Math.round(h)} horas`;
  else if (h < 36) txt = 'há um dia';
  else if (d < 26) txt = `há ${Math.round(d)} dias`;
  else if (d < 45) txt = 'há um mês';
  else if (d < 320) txt = `há ${Math.round(d / 30.4)} meses`;
  else if (d < 548) txt = 'há um ano';
  else txt = `há ${Math.round(d / 365)} anos`;
  return `Última atualização ${txt}`;
}
