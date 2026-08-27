export interface BleSighting {
  id: string;
  deviceId: string;
  macAddress: string;
  rssi: number | null;
  accuracy: number | null;
  seenAt: string;
  hashedAdvKey: string | null;
  counterByte: number | null;
  scannerLat: number | null;
  scannerLng: number | null;
  scannerSource: string | null;
  tenantId: string;
  createdAt: string;
}

export interface BleTag {
  id: string;
  imei: string;
  model: 'BLE_KTAG' | 'BLE_REDTAG' | 'BLE_AIRTAG_GENERIC';
  brand: string | null;
  notes: string | null;
  status: string;
  vehicleId: string | null;
  tenantId: string;
  installedAt: string | null;
  lastConnection: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  vehicle: {
    id: string;
    plate: string;
    brand: string | null;
    model: string | null;
  } | null;
  bleSightings: Array<Pick<BleSighting, 'id' | 'macAddress' | 'rssi' | 'accuracy' | 'seenAt' | 'scannerLat' | 'scannerLng' | 'scannerSource' | 'createdAt'>>;
}

export interface BleSightingEvent {
  deviceId: string;
  deviceImei: string;
  deviceModel: string;
  vehicleId: string | null;
  sighting: {
    id: string;
    macAddress: string;
    rssi: number | null;
    accuracy: number | null;
    seenAt: string;
    scannerLat: number | null;
    scannerLng: number | null;
    scannerSource: string | null;
    createdAt: string;
  };
}

/**
 * TAG em uso, como o SGA enxerga: o cliente contratou TAG (com rastreador ou
 * sozinha) e está ativo. `tag` só vem preenchida quando a TAG também está
 * cadastrada aqui, com número e MAC — o que é raro.
 */
export interface ActiveTagRow {
  id: string;
  plate: string;
  chassi: string | null;
  brandModel: string;
  associateName: string;
  cpf: string | null;
  phone: string | null;
  tipo: 'RASTREADOR_E_TAG' | 'SO_TAG';
  contractDate: string | null;
  hinovaVehicleCode: string;
  /** Id do veículo no 21 GO, quando ele existe aqui. */
  vehicleId: string | null;
  tag: {
    id: string;
    imei: string;
    model: string;
    brand: string | null;
    macAddress: string | null;
    lastSeenAt: string | null;
  } | null;
  /**
   * Qual é a TAG e onde ela foi vista pela última vez, pelo espelho da
   * plataforma de origem. É o que responde "abrir no mapa" para a TAG.
   *
   * `seenAt` NÃO é tempo real: a TAG só é vista quando alguém passa perto.
   * Em 2 de cada 3 TAGs esse carimbo tem mais de 30 dias — por isso a idade
   * vai sempre visível no card, nunca escondida.
   */
  tagEspelho: {
    identificador: string;
    modelo: string | null;
    latitude: number | null;
    longitude: number | null;
    seenAt: string | null;
    origem: string;
  } | null;
  /**
   * Última posição do RASTREADOR do veículo (a TAG não reporta sozinha).
   * Null quando o veículo não é nosso, não tem rastreador ou o servidor GPS
   * não respondeu.
   */
  ultimaPosicao: {
    latitude: number;
    longitude: number;
    fixTime: string | null;
    address: string | null;
    speed: number;
    confiavel: boolean;
  } | null;
}

export interface ActiveTagsResponse {
  data: ActiveTagRow[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    comRastreador: number;
    soTag: number;
  };
}

/**
 * Um avistamento pronto para desenhar. `latenciaSeg` é a distância entre a
 * TAG ter sido vista e o relatório chegar até nós — vai sempre à tela, porque
 * é o que impede o operador de ler posição de TAG como posição atual.
 */
export interface PontoTrilha {
  lat: number;
  lng: number;
  accuracy: number | null;
  seenAt: string;
  latenciaSeg: number;
}

/** Trecho contínuo da trilha. A quebra entre segmentos é buraco de sinal. */
export interface SegmentoTrilha {
  pontos: PontoTrilha[];
}

export interface TrailResposta {
  segmentos: SegmentoTrilha[];
  totalAvistamentos: number;
}

export interface LocalHabitualInfo {
  centroLat: number;
  centroLng: number;
  totalAvistamentos: number;
  diasDistintos: number;
  faixaHorariaTexto: string;
  participacaoPct: number;
  endereco: string | null;
}

export type PernoiteInfo = LocalHabitualInfo;

export interface UltimaParadaInfo {
  centroLat: number;
  centroLng: number;
  paradoDesde: string;
  /** Falso quando o avistamento envelheceu: a TAG pode já ter saído de lá. */
  aindaLa: boolean;
  ultimoAvistamento: string;
  endereco: string | null;
}

export interface InsightsResposta {
  janelaDias: number;
  totalAvistamentos: number;
  locaisHabituais: LocalHabitualInfo[];
  pernoite: PernoiteInfo | null;
  ultimaParada: UltimaParadaInfo | null;
}
