export interface HinovaVehicleDto {
  codigoVeiculo: string;
  placa: string;
  chassi: string | null;
  renavam: string | null;
  marca: string;
  modelo: string;
  cor: string;
  anoFabricacao: number;
  anoModelo: number;
  status: 'ATIVO' | 'INATIVO' | 'INADIMPLENTE';
  associado: {
    codigoAssociado: string;
    nome: string;
    cpf: string;
    rg: string | null;
    dataNascimento: string | null;
    telefone: string | null;
    email: string | null;
  };
}

export interface HinovaListResponse {
  data: HinovaVehicleDto[];
  total: number;
  pagina: number;
  porPagina: number;
}
