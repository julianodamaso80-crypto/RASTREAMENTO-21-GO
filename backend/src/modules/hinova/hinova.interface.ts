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
/**
 * Situações de veículo do SGA (codigo_situacao / codigo_situacao_veiculo),
 * levantadas na API real em 2026-08-19 — a rota /situacao/listar/todos exige
 * liberação que a integração não tem.
 */
export const SITUACOES_SGA: Record<string, string> = {
  '1': 'ATIVO',
  '2': 'INATIVO',
  '3': 'PENDENTE',
  '4': 'INADIMPLENTE',
  '5': 'NEGADO',
};

export interface HinovaLookupResult {
  encontrado: boolean;
  /** codigo_situacao_veiculo === '1' (ATIVO no SGA). */
  ativo: boolean;
  /**
   * Boleto vencido (situacao_financeira === 'INADIMPLENTE'). Só o lookup ao vivo
   * sabe disto; pelo espelho cadastral vem false.
   *
   * É AVISO, não barreira. O endpoint financeiro devolve um boleto isolado, que
   * pode estar vencido há mais de um ano com o cadastro ATIVO. Quem bloqueia o
   * vínculo é a situação do cadastro (`ativo`).
   */
  boletoVencido?: boolean;
  /** Motivo quando não encontrado/indisponível (ex.: mensagem de erro do SGA). */
  motivo?: string;
  /**
   * De onde saiu a resposta. `sga` = consulta ao vivo. `cadastro` = espelho
   * cadastral do SGA (todo veículo, qualquer situação). `espelho` = espelho da
   * fila de pendências. Os dois espelhos vêm do /listar/veiculo do próprio SGA
   * e cobrem o veículo novo, que o lookup ao vivo recusa por não ter boleto.
   */
  fonte?: 'sga' | 'cadastro' | 'espelho';
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
    /**
     * `tipo` do SGA, cru ("MOTOCICLETA (ATé 400CC)", "VEICULOS LEVES"…).
     * Traduzido por `tipoVeiculoDoSga()` na hora de gravar o veículo — é o que
     * decide se o mapa desenha carro ou moto. Só o espelho cadastral preenche;
     * o lookup financeiro ao vivo não devolve o tipo.
     */
    tipo?: string | null;
  };
  situacao: {
    codigo: string | null;
    descricao: string | null;
    financeira: string | null;
    dataVencimento: string | null;
  };
}

/**
 * Linha crua de veículo do POST /listar/veiculo.
 *
 * A doc oficial do SGA documenta 26 campos no retorno; a API devolve 63.
 * `codigo_tipo_adesao` — que é onde vive a pendência de instalação — está entre
 * os NÃO documentados, confirmado inspecionando a resposta real em 2026-07-22.
 * Tipado só o que consumimos; o resto passa como index signature.
 */
export interface HinovaRawVehicle {
  codigo_veiculo?: string;
  codigo_associado?: string;
  /** Vem vazia em veículo ainda sem emplacamento. */
  placa?: string;
  chassi?: string;
  marca?: string;
  modelo?: string;
  tipo?: string;
  /** 1 = PENDENTE INSTALAÇÃO DE RASTREADOR · 10 = PENDENTE INSTALAÇÃO DE TAG. */
  codigo_tipo_adesao?: string;
  /** 1 ATIVO · 2 INATIVO · 3 PENDENTE · 4 INADIMPLENTE · 5 NEGADO. */
  codigo_situacao?: string;
  descricao_situacao?: string;
  valor_fipe_protegido?: string;
  valor_fipe?: number;
  data_contrato?: string;
  codigo_tabela_avaliacao?: string;
  nome_associado?: string;
  cpf_associado?: string;
  email?: string;
  ddd?: string;
  telefone?: string;
  ddd_celular?: string;
  telefone_celular?: string;
  nome_voluntario?: string;
  [key: string]: unknown;
}

/** Linha crua de associado do POST /listar/associado/ (traz endereço completo). */
export interface HinovaRawAssociate {
  codigo_associado?: string;
  cidade?: string;
  bairro?: string;
  logradouro?: string;
  numero?: string;
  cep?: string;
  estado?: string;
  [key: string]: unknown;
}

export interface IHinovaClient {
  authenticate(): Promise<void>;
  /** Consulta uma placa ao vivo no SGA (usada pelo fluxo Associar cliente e ativo). */
  lookupByPlate(placa: string): Promise<HinovaLookupResult>;
  listVehicles(page: number, perPage: number): Promise<HinovaListResponse>;
  searchByPlate(plate: string): Promise<HinovaVehicleDto | null>;
  searchByCpf(cpf: string): Promise<HinovaVehicleDto[]>;
  /**
   * Página crua de veículos ATIVOS, sem mapeamento — o sync de pendências
   * precisa de campos que o HinovaVehicleDto não carrega.
   */
  listRawActiveVehicles(offset: number, limit: number): Promise<HinovaRawVehicle[]>;
  /** Página crua de veículos numa situação qualquer (espelho cadastral). */
  listRawVehiclesBySituation(
    situacao: number,
    offset: number,
    limit: number,
  ): Promise<HinovaRawVehicle[]>;
  /** Página crua de associados ATIVOS (fonte de cidade/bairro). */
  listRawActiveAssociates(offset: number, limit: number): Promise<HinovaRawAssociate[]>;
}
