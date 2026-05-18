import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class TraccarService implements OnModuleInit {
  private readonly logger = new Logger(TraccarService.name);
  private client: AxiosInstance;
  private sessionCookie: string | null = null;
  private readonly apiUrl: string;
  private readonly adminEmail: string;
  private readonly adminPassword: string;

  constructor(private configService: ConfigService) {
    this.apiUrl = this.configService.get<string>('traccar.apiUrl')!;
    this.adminEmail = this.configService.get<string>('traccar.adminEmail')!;
    this.adminPassword = this.configService.get<string>(
      'traccar.adminPassword',
    )!;

    this.client = axios.create({
      baseURL: this.apiUrl,
      timeout: 30000,
    });

    // Interceptor para injetar cookie de sessão
    this.client.interceptors.request.use((config) => {
      if (this.sessionCookie) {
        config.headers['Cookie'] = this.sessionCookie;
      }
      return config;
    });
  }

  async onModuleInit() {
    try {
      await this.createSession();
      this.logger.log('Sessão Traccar criada com sucesso');
    } catch (error) {
      this.logger.warn(
        `Falha ao conectar com Traccar (pode não estar rodando): ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async createSession(): Promise<void> {
    const params = new URLSearchParams();
    params.append('email', this.adminEmail);
    params.append('password', this.adminPassword);

    const response = await this.client.post('/session', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      this.sessionCookie = setCookie
        .map((c: string) => c.split(';')[0])
        .join('; ');
    }
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    retries = 3,
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        const axiosError = error as { response?: { status: number } };
        // Se 401, tenta re-autenticar
        if (axiosError.response?.status === 401 && attempt < retries) {
          this.logger.warn('Sessão Traccar expirada, re-autenticando...');
          await this.createSession();
          continue;
        }

        if (attempt === retries) throw error;

        const delay = Math.pow(2, attempt - 1) * 1000;
        this.logger.warn(
          `Tentativa ${attempt}/${retries} falhou. Retry em ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error('Retries exhausted');
  }

  // === Server ===

  async getServer(): Promise<any> {
    return this.withRetry(async () => {
      const { data } = await this.client.get('/server');
      return data;
    });
  }

  // === Devices ===

  async getDevices(): Promise<TraccarDevice[]> {
    return this.withRetry(async () => {
      const { data } = await this.client.get('/devices');
      return data;
    });
  }

  async getDevice(id: number): Promise<TraccarDevice> {
    return this.withRetry(async () => {
      const { data } = await this.client.get(`/devices?id=${id}`);
      return data[0];
    });
  }

  /**
   * Busca um device pelo `uniqueId` (IMEI). Retorna `null` se não existir.
   * O Traccar não expõe filtro server-side por uniqueId; fazemos client-side.
   * Aceitável até ~5k devices; acima disso considerar cache em Redis.
   */
  async getDeviceByUniqueId(uniqueId: string): Promise<TraccarDevice | null> {
    return this.withRetry(async () => {
      const { data } = await this.client.get<TraccarDevice[]>('/devices');
      return data.find((d) => d.uniqueId === uniqueId) ?? null;
    });
  }

  async createDevice(name: string, uniqueId: string): Promise<TraccarDevice> {
    return this.withRetry(async () => {
      const { data } = await this.client.post('/devices', {
        name,
        uniqueId,
      });
      return data;
    });
  }

  async updateDevice(
    id: number,
    payload: Partial<TraccarDevice>,
  ): Promise<TraccarDevice> {
    return this.withRetry(async () => {
      const { data } = await this.client.put(`/devices/${id}`, {
        id,
        ...payload,
      });
      return data;
    });
  }

  async deleteDevice(id: number): Promise<void> {
    return this.withRetry(async () => {
      await this.client.delete(`/devices/${id}`);
    });
  }

  // === Positions ===

  async getPositions(
    deviceId?: number,
    from?: string,
    to?: string,
  ): Promise<TraccarPosition[]> {
    return this.withRetry(async () => {
      const params: Record<string, string | number> = {};
      if (deviceId) params.deviceId = deviceId;
      if (from) params.from = from;
      if (to) params.to = to;
      const { data } = await this.client.get('/positions', { params });
      return data;
    });
  }

  async getReportSummary(
    deviceIds: number[],
    from: string,
    to: string,
  ): Promise<TraccarReportSummary[]> {
    if (deviceIds.length === 0) return [];
    return this.withRetry(async () => {
      const params = new URLSearchParams();
      for (const id of deviceIds) params.append('deviceId', String(id));
      params.append('from', from);
      params.append('to', to);
      params.append('daily', 'false');
      const { data } = await this.client.get(
        `/reports/summary?${params.toString()}`,
        {
          headers: { Accept: 'application/json' },
        },
      );
      return data;
    });
  }

  // === Commands ===

  async sendCommand(
    deviceId: number,
    type: string,
    attributes?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.withRetry(async () => {
      const { data } = await this.client.post('/commands/send', {
        deviceId,
        type,
        attributes: attributes || {},
      });
      return data;
    });
  }

  // === Users ===

  async createUser(
    email: string,
    password: string,
    name: string,
  ): Promise<TraccarUser> {
    return this.withRetry(async () => {
      const { data } = await this.client.post('/users', {
        name,
        email,
        password,
      });
      return data;
    });
  }

  // === Geofences ===

  async createGeofence(name: string, area: string): Promise<TraccarGeofence> {
    return this.withRetry(async () => {
      const { data } = await this.client.post('/geofences', { name, area });
      return data;
    });
  }

  async updateGeofence(
    id: number,
    name: string,
    area: string,
  ): Promise<TraccarGeofence> {
    return this.withRetry(async () => {
      const { data } = await this.client.put(`/geofences/${id}`, {
        id,
        name,
        area,
      });
      return data;
    });
  }

  async deleteGeofence(id: number): Promise<void> {
    return this.withRetry(async () => {
      await this.client.delete(`/geofences/${id}`);
    });
  }

  async linkDeviceGeofence(
    deviceId: number,
    geofenceId: number,
  ): Promise<void> {
    return this.withRetry(async () => {
      await this.client.post('/permissions', { deviceId, geofenceId });
    });
  }

  async unlinkDeviceGeofence(
    deviceId: number,
    geofenceId: number,
  ): Promise<void> {
    return this.withRetry(async () => {
      await this.client.delete('/permissions', {
        data: { deviceId, geofenceId },
      });
    });
  }

  getSessionCookie(): string | null {
    return this.sessionCookie;
  }

  getApiUrl(): string {
    return this.apiUrl;
  }
}

// Tipos simplificados do Traccar
export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
  status: string;
  lastUpdate: string;
  positionId: number;
  groupId: number;
  phone: string;
  model: string;
  contact: string;
  category: string;
  disabled: boolean;
  attributes: Record<string, unknown>;
}

/**
 * Atributos reportados pelo rastreador via Traccar. Disponibilidade varia por protocolo
 * (GT06, Suntech, Teltonika, etc.) e por firmware. Sempre opcionais — código consumidor
 * deve checar `undefined` antes de usar. Atributos exóticos caem em `rawAttributes` na
 * persistência (Position.rawAttributes), preservando dado bruto pra evoluir o dicionário.
 */
export interface TraccarPositionAttributes {
  ignition?: boolean;
  motion?: boolean;
  batteryLevel?: number;
  power?: number;
  charge?: boolean;
  charging?: boolean;
  rpm?: number;
  fuel?: number;
  fuelConsumption?: number;
  temp1?: number;
  temp2?: number;
  temperature?: number;
  odometer?: number;
  totalDistance?: number;
  hours?: number;
  engineHours?: number;
  sat?: number;
  satellites?: number;
  rssi?: number;
  gsmSignal?: number;
  hdop?: number;
  alarm?: string;
  alarmType?: string;
  powerCut?: boolean;
  jamming?: boolean;
  vibration?: boolean;
  jarring?: boolean;
  collision?: boolean;
  tamper?: boolean;
  sos?: boolean;
  blocked?: boolean;
  door?: boolean;
  io1?: number;
  io2?: number;
  io3?: number;
  io4?: number;
  [key: string]: unknown;
}

export interface TraccarPosition {
  id: number;
  deviceId: number;
  protocol: string;
  deviceTime: string;
  fixTime: string;
  serverTime: string;
  outdated: boolean;
  valid: boolean;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  course: number;
  address: string;
  accuracy: number;
  attributes: TraccarPositionAttributes;
}

export interface TraccarUser {
  id: number;
  name: string;
  email: string;
  administrator: boolean;
}

export interface TraccarGeofence {
  id: number;
  name: string;
  area: string;
  attributes: Record<string, unknown>;
}

export interface TraccarReportSummary {
  deviceId: number;
  deviceName: string;
  startTime: string;
  endTime: string;
  distance: number; // metros
  averageSpeed: number; // knots
  maxSpeed: number; // knots
  spentFuel: number;
  startOdometer: number;
  endOdometer: number;
  engineHours: number;
}
