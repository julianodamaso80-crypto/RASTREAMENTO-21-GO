import type {
  HinovaVehicleDto,
  HinovaListResponse,
} from './dto/hinova-vehicle.dto';

export const HINOVA_CLIENT = 'HINOVA_CLIENT';

/**
 * Resultado normalizado da consulta de uma placa ao SGA em tempo real.
 * Fonte: GET /buscar/situacao-financeira-veiculo/:placa (único GET ao vivo que
 * funciona com o token de integração — o /veiculo/buscar/:placa exige permissão
 * por cooperativa que a integração não tem).
 */
export interface HinovaLookupResult {
  encontrado: boolean;
  /** codigo_situacao_veiculo === '1' (ATIVO no SGA). */
  ativo: boolean;
  /** Motivo quando não encontrado/indisponível (ex.: mensagem de erro do SGA). */
  motivo?: string;
  cliente: {
    nome: string | null;
    cpf: string | null;
  };
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

export interface IHinovaClient {
  authenticate(): Promise<void>;
  /** Consulta uma placa ao vivo no SGA (usada pelo fluxo Associar cliente e ativo). */
  lookupByPlate(placa: string): Promise<HinovaLookupResult>;
  listVehicles(page: number, perPage: number): Promise<HinovaListResponse>;
  searchByPlate(plate: string): Promise<HinovaVehicleDto | null>;
  searchByCpf(cpf: string): Promise<HinovaVehicleDto[]>;
}
