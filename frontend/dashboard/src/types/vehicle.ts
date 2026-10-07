export type VehicleStatus = 'ACTIVE' | 'INACTIVE' | 'DEFAULTING' | 'BLOCKED';
/** Tipo do veículo — define o desenho usado no mapa (carro x moto). */
export type VehicleType = 'CAR' | 'MOTORCYCLE';
/**
 * Estado da comunicação do rastreador — a MESMA régua e os mesmos nomes da
 * RedeVeiculos (lidos no mapa /rastreamento/v2/ deles em 07/10/2026):
 *
 *  online   — comunicou há até 30 min                    → verde    "ONLINE"
 *  sem_resp — comunicou há 30–60 min                     → amarelo  "S/RESP"
 *  sem_gps  — comunicando, mas sem nenhuma posição GPS   → preto    "S/GPS"
 *  sleep    — moto calada há menos de 2 dias             → azul     "SLEEP"
 *  offline  — o resto                                    → laranja  "OFFLINE"
 *  alert    — veículo BLOQUEADO                          → vermelho "Bloqueado"
 *
 * Nunca "defeito" e nunca "ligue para a central": carro parado na garagem
 * aparece OFFLINE com "Última atualização há X", que é fato, não diagnóstico.
 * Ignição e movimento são informação à parte (`ignition`, `moving`).
 */
export type DisplayStatus =
  | 'online'
  | 'sem_resp'
  | 'sem_gps'
  | 'sleep'
  | 'offline'
  | 'alert';

export interface Associate {
  id: string;
  name: string;
  cpf: string;
  phone: string | null;
}

export interface Vehicle {
  id: string;
  plate: string;
  vehicleType: VehicleType;
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  chassi: string | null;
  renavam: string | null;
  uniqueId: string;
  traccarDeviceId: number | null;
  status: VehicleStatus;
  tenantId: string;
  associateId: string | null;
  hinovaCode: string | null;
  lastSync: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  associate: Associate | null;
  /** Rastreador vinculado. Só o que o painel precisa mostrar. */
  device?: {
    /** Identidade do equipamento em campo. Ausente na rota do cliente final. */
    imei?: string | null;
    model?: string | null;
    status?: string | null;
    installedAt?: string | null;
    installLocation: string | null;
  } | null;
}

export interface VehicleWithTracking extends Vehicle {
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  address: string;
  // Heartbeat do device (Traccar lastUpdate). Pode ser keep-alive sem GPS novo.
  lastUpdate: string;
  // Timestamp da ÚLTIMA posição GPS real (Traccar position.deviceTime/serverTime).
  // Usar este quando a pergunta é "quando o GPS mexeu pela última vez?".
  // Quando null, nunca houve posição.
  positionTime: string | null;
  deviceStatus: string;
  displayStatus: DisplayStatus;
  ignition: boolean;
  /** Andando agora: GPS recente (STALE_POSITION_MS) e velocidade acima do ruído. */
  moving: boolean;
  satellites: number;
}
