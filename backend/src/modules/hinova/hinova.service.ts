import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import type { IHinovaClient } from './hinova.interface';
import type { HinovaVehicleDto, HinovaListResponse } from './dto/hinova-vehicle.dto';

@Injectable()
export class HinovaService implements IHinovaClient {
  private readonly logger = new Logger(HinovaService.name);
  private readonly client: AxiosInstance;
  private token: string | null = null;

  constructor(private configService: ConfigService) {
    const baseUrl = this.configService.get<string>('hinova.baseUrl')!;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });
  }

  private async withRetry<T>(operation: () => Promise<T>, retries = 3): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        const axiosError = error as { response?: { status: number } };
        if (axiosError.response?.status === 401 && attempt < retries) {
          this.logger.warn('Token Hinova expirado, re-autenticando...');
          await this.authenticate();
          continue;
        }
        if (attempt === retries) throw error;
        const delay = Math.pow(2, attempt - 1) * 1000;
        this.logger.warn(`Tentativa ${attempt}/${retries} falhou. Retry em ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error('Retries exhausted');
  }

  async authenticate(): Promise<void> {
    this.logger.log('Autenticando na API Hinova...');
    // TODO: Implementar quando credenciais estiverem disponíveis
    // const { data } = await this.client.post('/auth/login', { usuario, senha });
    // this.token = data.token;
    throw new Error('Hinova real service: credenciais não configuradas. Use HINOVA_MOCK=true');
  }

  async listVehicles(page: number, perPage: number): Promise<HinovaListResponse> {
    return this.withRetry(async () => {
      const { data } = await this.client.get('/veiculos', {
        params: { pagina: page, porPagina: perPage },
      });
      this.logger.debug(`Hinova listVehicles: página ${page}, ${data.data?.length || 0} registros`);
      return data;
    });
  }

  async searchByPlate(plate: string): Promise<HinovaVehicleDto | null> {
    return this.withRetry(async () => {
      const { data } = await this.client.get('/veiculos/busca', {
        params: { placa: plate },
      });
      return data.data?.[0] || null;
    });
  }

  async searchByCpf(cpf: string): Promise<HinovaVehicleDto[]> {
    return this.withRetry(async () => {
      const { data } = await this.client.get('/veiculos/busca', {
        params: { cpf },
      });
      return data.data || [];
    });
  }
}
