export interface StockItem {
  id: string;
  imei: string;
  iccid: string | null;
  line: string | null;
  operator: string | null;
  status: string | null;
  server: string | null;
  registeredAt: string | null;
  activatedAt: string | null;
  notes: string | null;
  /** Técnico com quem o equipamento está reservado (null = livre no estoque). */
  assignedTechnician: { id: string; name: string } | null;
  assignedAt: string | null;
  /** Device correspondente no servidor GPS (null = ainda não cadastrado lá). */
  traccarDeviceId: number | null;
  /** Selo da conferência de instalação. Informativo — não bloqueia o vínculo. */
  validatedAt: string | null;
  validatedByName: string | null;
  validationOk: boolean | null;
  validationNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Diagnóstico ao vivo de um rastreador — o que o painel de validação mostra. */
export interface DeviceHealth {
  imei: string;
  encontradoNoGps: boolean;
  jaReportou: boolean;
  /** Chip conversando com o servidor (heartbeat — NÃO é GPS). */
  comunicando: boolean;
  lastUpdate: string | null;
  gps: {
    ok: boolean;
    fixTime: string | null;
    idadeSegundos: number | null;
    satellites: number | null;
    latitude: number | null;
    longitude: number | null;
    address: string | null;
  };
  energia: {
    volts: number | null;
    sistema: '12V' | '24V' | null;
    /**
     * `sem-leitura`: o equipamento confirma alimentação do veículo mas não mede
     * tensão — é o caso do parque gt06/J16. `cortada`: alimentação caiu.
     */
    faixa: 'ok' | 'baixa' | 'alta' | 'sem-leitura' | 'cortada' | 'ausente';
    bateriaInterna: number | null;
  };
  ignicao: { reportada: boolean; ligada: boolean | null };
  velocidade: number | null;
  direcao: number | null;
  distanceM: number | null;
  checkOk: boolean;
  motivos: string[];
  /** Servidor GPS fora do ar — nada aqui dentro vale. */
  indisponivel: boolean;
}

export interface StockConnectivityItem {
  conhecido: boolean;
  comunicando: boolean;
  gpsOk: boolean;
  lastUpdate: string | null;
}

export interface StockConnectivity {
  indisponivel: boolean;
  total: number;
  conectados: number;
  desconectados: number;
  semGps: number;
  semCadastro: number;
  statuses: Record<string, StockConnectivityItem>;
}

export interface StockValidateResult {
  id: string;
  validatedAt: string;
  validatedByName: string | null;
  validationOk: boolean | null;
  validationNotes: string | null;
  health: DeviceHealth;
}

/** Resultado da reserva/devolução em lote. `skipped` diz o que não foi e por quê. */
export interface StockAssignResult {
  ok: number;
  skipped: Array<{ imei: string; motivo: string }>;
}

export interface StockImportResult {
  imported: number;
  updated: number;
  skipped: number;
  total: number;
}

export interface StockStats {
  total: number;
  byStatus: Array<{ status: string; count: number }>;
}

/** Resultado da consulta de placa ao vivo no SGA (fluxo Associar). */
export interface HinovaLookup {
  encontrado: boolean;
  ativo: boolean;
  motivo?: string;
  cliente: { nome: string | null; cpf: string | null };
  veiculo: {
    placa: string | null;
    chassi: string | null;
    codigoModelo: string | null;
    modelo: string | null;
    codigoVeiculo: string | null;
  };
  situacao: {
    codigo: string | null;
    descricao: string | null;
    financeira: string | null;
    dataVencimento: string | null;
  };
}

export interface StockAssociateResult {
  ok: boolean;
  associateId: string;
  vehicleId: string;
  deviceId: string;
  placa: string;
}

/** Cliente ativo (associado com veículo/rastreador vinculado). */
export interface ActiveClient {
  id: string;
  name: string;
  cpf: string;
  phone: string | null;
  email: string | null;
  hinovaCode: string | null;
  createdAt: string;
  vehicles: Array<{
    id: string;
    plate: string;
    model: string | null;
    chassi: string | null;
    status: string;
    device: {
      id: string;
      imei: string;
      status: string;
      installedBy: string | null;
      installLocation: string | null;
      installedAt: string | null;
    } | null;
  }>;
}
