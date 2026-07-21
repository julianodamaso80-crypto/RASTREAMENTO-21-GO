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
  createdAt: string;
  updatedAt: string;
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
