import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

const TRACCAR_URL_MAX_BYTES = 8_000;

@Injectable()
export class TraccarService implements OnModuleInit {
  private readonly logger = new Logger(TraccarService.name);
  private client: AxiosInstance;
  private sessionCookie: string | null = null;
  private ultimoAvisoResumoGrande = 0;
  /** Id do usuário da sessão no Traccar — dono dos vínculos user↔device. */
  private sessionUserId: number | null = null;
  private readonly apiUrl: string;
  private readonly adminEmail: string;
  private readonly adminPassword: string;
  /**
   * A frota inteira do Traccar (`/devices` 2 MB, `/positions` 3 MB, ~450 ms
   * cada) era baixada ~30 vezes por minuto: painel a cada 8 s por aba, dois
   * crons por minuto, estoque, mapas (05/10/2026). Quem pede a mesma lista
   * dentro de 2 s recebe a mesma resposta, e chamadas simultâneas esperam
   * a mesma requisição em vez de abrir outra. Só vale para a lista completa:
   * consulta por device ou por período continua indo ao Traccar.
   */
  private static readonly FROTA_CACHE_MS = 2_000;
  private frotaCache = new Map<string, { at: number; promise: Promise<unknown> }>();

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

    const id = Number((response.data as { id?: unknown } | undefined)?.id);
    this.sessionUserId = Number.isFinite(id) && id > 0 ? id : null;

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

        // 4xx (fora o 401 acima) é erro do pedido, não transitório: repetir só
        // gasta tempo (414 em 22 ms virava +3 s de espera no painel).
        const status = axiosError.response?.status;
        if (status !== undefined && status >= 400 && status < 500) {
          this.logger.warn(
            `Traccar respondeu ${status} (sem retry): ${(error as { config?: { url?: string } }).config?.url?.split('?')[0] ?? 'rota desconhecida'}`,
          );
          throw error;
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

  /**
   * Sem `all`, o Traccar devolve só os devices VINCULADOS ao usuário da sessão
   * — mesmo para admin. Device que o próprio Traccar registra
   * (`database.registerUnknown`) nasce sem vínculo e fica invisível aqui;
   * `all: true` (só admin) lista a frota inteira.
   */
  async getDevices(opts?: { all?: boolean }): Promise<TraccarDevice[]> {
    const rota = opts?.all ? '/devices?all=true' : '/devices';
    return this.frotaCompartilhada(rota, () =>
      this.withRetry(async () => {
        const { data } = await this.client.get(rota);
        return data as TraccarDevice[];
      }),
    );
  }

  async getDevice(id: number): Promise<TraccarDevice> {
    return this.withRetry(async () => {
      const { data } = await this.client.get(`/devices?id=${id}`);
      return data[0];
    });
  }

  /**
   * Busca um device pelo `uniqueId` (IMEI). Retorna `null` se não existir.
   *
   * O Traccar 6 aceita `GET /devices?uniqueId=<imei>` (filtro server-side).
   * Antes baixávamos a frota inteira e filtrávamos em memória a cada chamada —
   * e isto roda no fluxo de instalação, inclusive a cada clique do técnico no
   * "conferir GPS". Fallback client-side fica só pra versão que não suportar.
   * Ver P2.4 do plano.
   */
  async getDeviceByUniqueId(uniqueId: string): Promise<TraccarDevice | null> {
    return this.withRetry(async () => {
      try {
        const { data } = await this.client.get<TraccarDevice[]>('/devices', {
          params: { uniqueId },
        });
        if (Array.isArray(data)) {
          return data.find((d) => d.uniqueId === uniqueId) ?? null;
        }
      } catch (error) {
        // 400 = versão do Traccar sem suporte ao filtro. Qualquer outro erro
        // (rede, 401, 5xx) sobe pro withRetry tratar.
        const status = (error as { response?: { status: number } }).response
          ?.status;
        if (status !== 400) throw error;
      }
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
    const buscar = () =>
      this.withRetry(async () => {
        const params: Record<string, string | number> = {};
        if (deviceId) params.deviceId = deviceId;
        if (from) params.from = from;
        if (to) params.to = to;
        const { data } = await this.client.get('/positions', { params });
        return data as TraccarPosition[];
      });
    if (deviceId || from || to) return buscar();
    return this.frotaCompartilhada('/positions', buscar);
  }

  /**
   * Última posição só dos devices pedidos. Ao contrário de `getPositions()`,
   * nunca vira consulta da frota inteira: sem id válido não chama o Traccar,
   * e o que vier fora do conjunto pedido é descartado.
   *
   * O `/positions` do Traccar aceita UM `deviceId` só (repetido, os demais são
   * ignorados), mas `id` é lista. Então: devices pelos ids → `positionId` de
   * cada um → `/positions?id=…`. Device sem `positionId` fica sem posição.
   * Quem já buscou os devices passa a lista e evita a segunda ida.
   */
  async getPositionsDosDevices(
    deviceIds: number[],
    devicesJaBuscados?: TraccarDevice[],
  ): Promise<TraccarPosition[]> {
    const pedidos = TraccarService.idsValidos(deviceIds);
    if (pedidos.length === 0) return [];
    const conjunto = new Set(pedidos);
    const devices = devicesJaBuscados ?? (await this.getDevicesPorIds(pedidos));
    const positionIds = devices
      .filter((d) => conjunto.has(d.id))
      .map((d) => d.positionId);
    const positions = await this.buscarPorIds<TraccarPosition>(
      '/positions',
      positionIds,
      (p) => p.id,
    );
    return positions.filter((p) => conjunto.has(p.deviceId));
  }

  /** Devices pelos ids, com as mesmas garantias de `getPositionsDosDevices`. */
  async getDevicesPorIds(deviceIds: number[]): Promise<TraccarDevice[]> {
    return this.buscarPorIds<TraccarDevice>('/devices', deviceIds, (d) => d.id);
  }

  private static idsValidos(ids: number[]): number[] {
    return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  }

  private static readonly IDS_POR_LOTE = 100;

  private async buscarPorIds<T>(
    rota: '/positions' | '/devices',
    ids: number[],
    idDe: (item: T) => number,
  ): Promise<T[]> {
    const pedidos = TraccarService.idsValidos(ids);
    if (pedidos.length === 0) return [];
    const conjunto = new Set(pedidos);
    const resultado: T[] = [];
    // Lotes com teto para a URL não estourar com associado de muitos veículos.
    for (let i = 0; i < pedidos.length; i += TraccarService.IDS_POR_LOTE) {
      const params = new URLSearchParams();
      for (const id of pedidos.slice(i, i + TraccarService.IDS_POR_LOTE)) {
        params.append('id', String(id));
      }
      const data = await this.withRetry(async () => {
        const { data } = await this.client.get(`${rota}?${params.toString()}`);
        return data as T[];
      });
      for (const item of data ?? []) {
        if (conjunto.has(idDe(item))) resultado.push(item);
      }
    }
    return resultado;
  }

  /** Início da busca da lista completa que o coalesce está servindo agora; `null` se não há uma vigente. */
  frotaBuscadaEm(rota: '/devices' | '/positions'): number | null {
    const emCache = this.frotaCache.get(rota);
    if (!emCache || Date.now() - emCache.at >= TraccarService.FROTA_CACHE_MS) {
      return null;
    }
    return emCache.at;
  }

  /**
   * Quem pede a lista completa dentro de 2 s recebe a mesma resposta, e
   * chamadas simultâneas esperam a mesma requisição em vez de abrir outra.
   * Falha não fica guardada: a próxima chamada tenta de novo na hora.
   */
  private frotaCompartilhada<T>(chave: string, buscar: () => Promise<T>): Promise<T> {
    const agora = Date.now();
    const emCache = this.frotaCache.get(chave);
    if (emCache && agora - emCache.at < TraccarService.FROTA_CACHE_MS) {
      return emCache.promise as Promise<T>;
    }
    const promise = buscar().catch((erro: unknown) => {
      if (this.frotaCache.get(chave)?.promise === promise) this.frotaCache.delete(chave);
      throw erro;
    });
    this.frotaCache.set(chave, { at: agora, promise });
    return promise;
  }

  async getReportSummary(
    deviceIds: number[],
    from: string,
    to: string,
  ): Promise<TraccarReportSummary[]> {
    if (deviceIds.length === 0) return [];
    const params = new URLSearchParams();
    for (const id of deviceIds) params.append('deviceId', String(id));
    params.append('from', from);
    params.append('to', to);
    params.append('daily', 'false');
    // O Traccar (Jetty) recusa URL acima de ~8 KB com 414. Com a frota inteira
    // (~7.200 ids, ~100 KB) o pedido nunca passa; km/top veículos ficam
    // indisponíveis para frotas grandes até uma versão fatiada ser aprovada
    // (decisão do dono — fatiamento NÃO implementado).
    if (params.toString().length > TRACCAR_URL_MAX_BYTES) {
      const agora = Date.now();
      if (agora - this.ultimoAvisoResumoGrande > 60_000) {
        this.ultimoAvisoResumoGrande = agora;
        this.logger.warn(
          `Frota grande demais para o relatório-resumo do Traccar (${deviceIds.length} devices); retornando vazio`,
        );
      }
      return [];
    }
    return this.withRetry(async () => {
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

  /**
   * Igual ao `sendCommand`, mas diz se o comando saiu na hora. O Traccar
   * responde 200 quando entrega ao rastreador conectado e 202 quando o guarda
   * na fila (`tc_commands_queue`) pra entregar quando ele voltar a falar.
   */
  async sendCommandNow(
    deviceId: number,
    type: string,
  ): Promise<{ enviado: boolean }> {
    return this.withRetry(async () => {
      const { status } = await this.client.post('/commands/send', {
        deviceId,
        type,
        attributes: {},
      });
      return { enviado: status === 200 };
    });
  }

  /**
   * Espera a resposta do rastreador a um comando enviado em `desde` — o texto
   * que ele devolve (ex.: "Cut off the fuel supply: Success!"). O Traccar grava
   * a resposta como evento `commandResult` com o texto no atributo `result` da
   * posição. `null` se o aparelho não responder dentro do prazo.
   */
  async aguardarRespostaDeComando(
    deviceId: number,
    desde: Date,
    prazoMs = 10_000,
    intervaloMs = 1_500,
  ): Promise<string | null> {
    const limite = Date.now() + prazoMs;
    while (Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, intervaloMs));
      try {
        const { data: eventos } = await this.client.get<
          { positionId?: number }[]
        >('/reports/events', {
          params: {
            deviceId,
            type: 'commandResult',
            from: new Date(desde.getTime() - 2_000).toISOString(),
            to: new Date(Date.now() + 60_000).toISOString(),
          },
          headers: { Accept: 'application/json' },
        });
        const positionId = eventos[eventos.length - 1]?.positionId;
        if (!positionId) continue;
        const { data: posicoes } = await this.client.get<TraccarPosition[]>(
          '/positions',
          { params: { id: positionId } },
        );
        const resultado = posicoes[0]?.attributes?.result;
        if (resultado != null) return String(resultado);
      } catch (erro) {
        // Resposta é conforto: o comando já saiu. Falha de leitura não vira erro.
        this.logger.warn(
          `Não consegui ler a resposta do comando (deviceId=${deviceId}): ${
            erro instanceof Error ? erro.message : erro
          }`,
        );
        return null;
      }
    }
    return null;
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

  /**
   * Vincula o device ao usuário da sessão. Sem o vínculo, `/devices` e
   * `/positions` (sem `all`) não enxergam o aparelho — é o caso de todo device
   * que o Traccar registrou sozinho.
   */
  async linkDeviceToSessionUser(deviceId: number): Promise<void> {
    return this.withRetry(async () => {
      if (!this.sessionUserId) await this.createSession();
      if (!this.sessionUserId) {
        throw new Error('Sessão do Traccar sem id de usuário');
      }
      await this.client.post('/permissions', {
        userId: this.sessionUserId,
        deviceId,
      });
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
