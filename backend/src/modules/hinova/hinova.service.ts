import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import * as https from 'https';
import type {
  IHinovaClient,
  HinovaLookupResult,
  HinovaRawVehicle,
  HinovaRawAssociate,
} from './hinova.interface';
import type {
  HinovaVehicleDto,
  HinovaListResponse,
} from './dto/hinova-vehicle.dto';

/**
 * Cliente de LEITURA da Hinova SGA API v2.
 * Doc: https://api.hinova.com.br/api/sga/v2/doc/
 *
 * Fluxo real (validado contra a base do 21 GO, 2026-07-16):
 * - Auth: POST /usuario/autenticar  (header Bearer = token de integração;
 *   body { usuario, senha }) → { token_usuario }. token_usuario não expira.
 * - Consulta por placa ao vivo: GET /buscar/situacao-financeira-veiculo/:placa
 *   (o /veiculo/buscar/:placa retorna "sem permissão na cooperativa").
 * - Listagem em massa (sync): POST /listar/veiculo (paginada).
 * Credenciais só via env; token/CPF nunca são logados.
 */
@Injectable()
export class HinovaService implements IHinovaClient {
  private readonly logger = new Logger(HinovaService.name);
  private readonly client: AxiosInstance;
  private readonly token: string; // token de integração (pré-compartilhado)
  private readonly usuario: string;
  private readonly senha: string;
  private tokenUsuario: string | null = null; // token de sessão (cacheado)

  constructor(private configService: ConfigService) {
    const baseUrl = this.configService.get<string>('hinova.baseUrl')!;
    this.token = this.configService.get<string>('hinova.token') || '';
    this.usuario = this.configService.get<string>('hinova.usuario') || '';
    this.senha = this.configService.get<string>('hinova.senha') || '';
    const verifySsl = this.configService.get<boolean>('hinova.verifySsl');

    this.client = axios.create({
      baseURL: baseUrl.replace(/\/$/, ''),
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
      // Em produção verifySsl é true; só cai pra false em ambiente local sem CA.
      ...(verifySsl === false
        ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
        : {}),
    });
  }

  private configured(): boolean {
    return !!(this.token && this.usuario && this.senha);
  }

  /** Autentica e cacheia o token_usuario em memória (não expira; reautentica em 401). */
  async authenticate(): Promise<void> {
    if (!this.configured()) {
      throw new Error(
        'Hinova SGA: credenciais ausentes (HINOVA_SGA_TOKEN/USUARIO/SENHA).',
      );
    }
    const { data } = await this.client.post(
      '/usuario/autenticar',
      { usuario: this.usuario, senha: this.senha },
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    this.tokenUsuario = data?.token_usuario ?? null;
    if (!this.tokenUsuario) {
      throw new Error('Hinova SGA: autenticação sem token_usuario.');
    }
    this.logger.log('Hinova SGA autenticado.');
  }

  /** GET autenticado com reautenticação automática em 401. */
  private async get<T = unknown>(path: string): Promise<T> {
    if (!this.tokenUsuario) await this.authenticate();
    try {
      const { data } = await this.client.get(path, {
        headers: { Authorization: `Bearer ${this.tokenUsuario}` },
      });
      return data as T;
    } catch (error: unknown) {
      const status = (error as { response?: { status: number } }).response
        ?.status;
      if (status === 401) {
        await this.authenticate();
        const { data } = await this.client.get(path, {
          headers: { Authorization: `Bearer ${this.tokenUsuario}` },
        });
        return data as T;
      }
      throw error;
    }
  }

  /** POST autenticado com reautenticação automática em 401. */
  private async post<T = unknown>(
    path: string,
    body: unknown,
    timeout?: number,
  ): Promise<T> {
    if (!this.tokenUsuario) await this.authenticate();
    const config = {
      headers: { Authorization: `Bearer ${this.tokenUsuario}` },
      ...(timeout ? { timeout } : {}),
    };
    try {
      const { data } = await this.client.post(path, body, config);
      return data as T;
    } catch (error: unknown) {
      const status = (error as { response?: { status: number } }).response
        ?.status;
      if (status === 401) {
        await this.authenticate();
        const { data } = await this.client.post(path, body, {
          ...config,
          headers: { Authorization: `Bearer ${this.tokenUsuario}` },
        });
        return data as T;
      }
      throw error;
    }
  }

  private static normalizePlate(placa: string): string {
    return (placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private static emptyLookup(motivo: string): HinovaLookupResult {
    return {
      encontrado: false,
      ativo: false,
      motivo,
      cliente: { nome: null, cpf: null },
      veiculo: {
        placa: null,
        chassi: null,
        codigoModelo: null,
        modelo: null,
        codigoVeiculo: null,
      },
      situacao: {
        codigo: null,
        descricao: null,
        financeira: null,
        dataVencimento: null,
      },
    };
  }

  async lookupByPlate(placa: string): Promise<HinovaLookupResult> {
    const p = HinovaService.normalizePlate(placa);
    if (p.length < 7) {
      return HinovaService.emptyLookup('Placa inválida.');
    }

    let raw: unknown;
    try {
      raw = await this.get(`/buscar/situacao-financeira-veiculo/${p}`);
    } catch (error: unknown) {
      // O SGA retorna 406/erro para placa inexistente. Tratamos como não achado.
      const body = (error as { response?: { data?: unknown } }).response?.data;
      const motivo = HinovaService.extractError(body) || 'Placa não encontrada no SGA.';
      return HinovaService.emptyLookup(motivo);
    }

    // Resposta é um array com um objeto; ou um objeto de erro { mensagem, error }.
    const item = Array.isArray(raw) ? raw[0] : raw;
    if (!item || (item as { error?: unknown }).error || !(item as { placa?: string }).placa) {
      const motivo =
        HinovaService.extractError(item) || 'Placa não encontrada no SGA.';
      return HinovaService.emptyLookup(motivo);
    }

    const v = item as Record<string, string>;
    return {
      encontrado: true,
      ativo: String(v.codigo_situacao_veiculo) === '1',
      cliente: { nome: v.nome ?? null, cpf: v.cpf ?? null },
      veiculo: {
        placa: v.placa ?? p,
        chassi: v.chassi ?? null,
        codigoModelo: v.codigo_modelo ?? null,
        modelo: v.descricao_modelo ?? null,
        codigoVeiculo: v.codigo_veiculo ?? null,
      },
      situacao: {
        codigo: v.codigo_situacao_veiculo ?? null,
        descricao: v.descricao_situacao_veiculo ?? null,
        financeira: v.situacao_financeira ?? null,
        dataVencimento: v.data_vencimento ?? null,
      },
    };
  }

  private static extractError(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as { error?: unknown; mensagem?: unknown };
    if (Array.isArray(b.error) && b.error.length) return String(b.error[0]);
    if (typeof b.error === 'string') return b.error;
    if (typeof b.mensagem === 'string') return b.mensagem;
    return null;
  }

  /** Listagem em massa (usada pelo cron de sync). */
  async listVehicles(
    page: number,
    perPage: number,
  ): Promise<HinovaListResponse> {
    const data = await this.post<{
      veiculos?: Array<Record<string, string>>;
      total_veiculos?: number;
    }>('/listar/veiculo', {
      codigo_situacao: 1,
      inicio_paginacao: (page - 1) * perPage,
      quantidade_por_pagina: perPage,
    });

    const veiculos = data.veiculos ?? [];
    return {
      data: veiculos.map((v) => HinovaService.mapListItem(v)),
      total: Number(data.total_veiculos ?? 0),
      pagina: page,
      porPagina: perPage,
    };
  }

  private static mapListItem(v: Record<string, string>): HinovaVehicleDto {
    const statusMap: Record<string, HinovaVehicleDto['status']> = {
      ATIVO: 'ATIVO',
      INATIVO: 'INATIVO',
      INADIMPLENTE: 'INADIMPLENTE',
    };
    return {
      codigoVeiculo: String(v.codigo_veiculo ?? ''),
      placa: v.placa ?? '',
      chassi: v.chassi ?? null,
      renavam: v.renavam ?? null,
      marca: v.marca ?? '',
      modelo: v.modelo ?? '',
      cor: v.codigo_cor ?? '',
      anoFabricacao: Number(v.ano_fabricacao ?? 0),
      anoModelo: Number(v.ano_modelo ?? 0),
      status: statusMap[String(v.descricao_situacao).toUpperCase()] ?? 'ATIVO',
      associado: {
        codigoAssociado: String(v.codigo_associado ?? ''),
        nome: v.nome_associado ?? '',
        cpf: v.cpf_associado ?? '',
        rg: v.rg_associado ?? null,
        dataNascimento: null,
        telefone:
          [v.ddd_celular, v.telefone_celular].filter(Boolean).join(' ') ||
          [v.ddd, v.telefone].filter(Boolean).join(' ') ||
          null,
        email: v.email ?? null,
      },
    };
  }

  async searchByPlate(plate: string): Promise<HinovaVehicleDto | null> {
    const r = await this.lookupByPlate(plate);
    if (!r.encontrado) return null;
    return {
      codigoVeiculo: r.veiculo.codigoVeiculo ?? '',
      placa: r.veiculo.placa ?? plate,
      chassi: r.veiculo.chassi,
      renavam: null,
      marca: '',
      modelo: r.veiculo.modelo ?? '',
      cor: '',
      anoFabricacao: 0,
      anoModelo: 0,
      status:
        (r.situacao.descricao?.toUpperCase() as HinovaVehicleDto['status']) ??
        'ATIVO',
      associado: {
        codigoAssociado: '',
        nome: r.cliente.nome ?? '',
        cpf: r.cliente.cpf ?? '',
        rg: null,
        dataNascimento: null,
        telefone: null,
        email: null,
      },
    };
  }

  async searchByCpf(_cpf: string): Promise<HinovaVehicleDto[]> {
    // Não usado na Fase 1; a busca por CPF direta tem barreira de cooperativa.
    return [];
  }

  /** Situação 1 = ATIVO, tanto para veículo quanto para associado no SGA. */
  private static readonly SITUACAO_ATIVA = 1;

  /**
   * Timeout das listagens em massa.
   *
   * O timeout global de 30s serve pro lookup por placa (resposta em ~1s) mas
   * não pra cá: o SGA degrada conforme o offset cresce — medido em 2026-07-22,
   * lote de 2.000 levou 19s no offset 0, 29s no 8.000, 34s no 16.000 e 59s no
   * 20.000. Era esse timeout que derrubava o sync no meio da varredura.
   */
  private static readonly TIMEOUT_LISTAGEM_MS = 240_000;

  /**
   * O SGA falha de forma transitória, às vezes por vários minutos seguidos:
   * 401 com token válido, 406 "Parâmetros Inválidos", e 502/timeout quando o
   * gateway dele cai (visto no sync de 2026-07-23). Sem retry robusto, uma
   * janela ruim de alguns minutos perde a varredura inteira.
   *
   * 8 tentativas com backoff que cresce até 60s cobre ~4min de instabilidade —
   * o suficiente pra atravessar os piques de 502 que observamos.
   */
  private async postComRetry<T>(path: string, body: unknown): Promise<T> {
    const TENTATIVAS = 8;
    const ESPERA_MAX_MS = 60_000;
    let ultimoErro: unknown;

    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
      try {
        return await this.post<T>(
          path,
          body,
          HinovaService.TIMEOUT_LISTAGEM_MS,
        );
      } catch (error: unknown) {
        ultimoErro = error;
        if (tentativa === TENTATIVAS) break;
        // 401 força reautenticação na próxima volta.
        if ((error as { response?: { status: number } }).response?.status === 401) {
          this.tokenUsuario = null;
        }
        const espera = Math.min(3000 * 2 ** (tentativa - 1), ESPERA_MAX_MS);
        this.logger.warn(
          `SGA ${path} falhou (tentativa ${tentativa}/${TENTATIVAS}): ${
            error instanceof Error ? error.message : error
          }. Repetindo em ${espera / 1000}s.`,
        );
        await new Promise((r) => setTimeout(r, espera));
      }
    }
    throw ultimoErro;
  }

  async listRawActiveVehicles(
    offset: number,
    limit: number,
  ): Promise<HinovaRawVehicle[]> {
    const data = await this.postComRetry<{ veiculos?: HinovaRawVehicle[] }>(
      '/listar/veiculo',
      {
        codigo_situacao: HinovaService.SITUACAO_ATIVA,
        inicio_paginacao: offset,
        quantidade_por_pagina: limit,
      },
    );
    return data.veiculos ?? [];
  }

  async listRawActiveAssociates(
    offset: number,
    limit: number,
  ): Promise<HinovaRawAssociate[]> {
    const data = await this.postComRetry<{ associados?: HinovaRawAssociate[] }>(
      '/listar/associado/',
      {
        codigo_situacao: HinovaService.SITUACAO_ATIVA,
        inicio_paginacao: offset,
        quantidade_por_pagina: limit,
      },
    );
    return data.associados ?? [];
  }
}
