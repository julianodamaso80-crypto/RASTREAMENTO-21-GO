import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService, type TraccarPosition } from './traccar.service';
import { assessPosition, type PositionRejectReason } from './position-quality';
import { DeviceRegistryService } from './device-registry.service';
import { AlertsService } from '../alerts/alerts.service';
import { BleTagsService } from '../ble-tags/ble-tags.service';
import { PositionsService } from '../positions/positions.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/tracking',
})
export class TraccarGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TraccarGateway.name);
  private traccarWs: WebSocket | null = null;
  // Cache: traccarDeviceId -> { tenantId, vehicleId }
  private deviceTenantMap = new Map<number, string>();
  private deviceVehicleMap = new Map<number, string>();
  // Cache: traccarDeviceId -> associateId (dono do veículo, quando houver).
  // Usado pra emitir posição SÓ pro app do associado dono — nunca vazar a
  // frota inteira do tenant pro cliente final.
  private deviceAssociateMap = new Map<number, string>();
  // Posições descartadas por qualidade: chave `deviceId:motivo` → contador.
  // Serve pra log agregado e pra diagnosticar rastreador com GPS ruim em campo.
  private rejectedPositions = new Map<
    string,
    { loggedAt: number; count: number }
  >();
  // Backoff exponencial pra reconnect WS Traccar
  private wsReconnectAttempts = 0;
  private readonly WS_BACKOFF_MIN_MS = 2_000;
  private readonly WS_BACKOFF_MAX_MS = 60_000;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private traccarService: TraccarService,
    private alertsService: AlertsService,
    private bleTagsService: BleTagsService,
    private positionsService: PositionsService,
    private deviceRegistry: DeviceRegistryService,
  ) {}

  async afterInit() {
    this.logger.log('WebSocket Gateway inicializado');

    // Instalação/retirada de rastreador atualiza o mapping na hora, em vez de
    // esperar o refresh de 2min (que deixava o carro recém-instalado invisível).
    this.deviceRegistry.setRefresher(() => this.refreshDeviceMapping());

    // Configurar emitter de alertas para WebSocket
    this.alertsService.setEmitter((tenantId, alert) => {
      this.server.to(`tenant:${tenantId}`).emit('alert:new', alert);
    });

    // Configurar emitter de detecções BLE (TAGs Apple Find My) para WebSocket
    this.bleTagsService.setEmitter((tenantId, payload) => {
      this.server.to(`tenant:${tenantId}`).emit('ble:sighting', payload);
    });

    await this.refreshDeviceMapping();
    this.connectToTraccar();
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('jwt.secret'),
      });

      // App do associado: entra SÓ na sua própria sala, nunca na do tenant —
      // assim recebe em tempo real apenas os veículos que são dele.
      if (payload.type === 'associate') {
        client.join(`associate:${payload.sub}`);
        client.data.associateId = payload.sub;
        this.logger.log(
          `Associado conectado: ${payload.name} (assoc: ${payload.sub})`,
        );
        return;
      }

      const tenantId = payload.tenantId;
      client.join(`tenant:${tenantId}`);
      client.data.tenantId = tenantId;
      client.data.userId = payload.sub;

      this.logger.log(
        `Cliente conectado: ${payload.email} (tenant: ${tenantId})`,
      );
    } catch {
      this.logger.warn('Cliente rejeitado: token inválido');
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(
      `Cliente desconectado: ${client.data?.userId || 'unknown'}`,
    );
  }

  async refreshDeviceMapping() {
    try {
      const vehicles = await this.prisma.vehicle.findMany({
        where: { traccarDeviceId: { not: null }, deletedAt: null },
        select: {
          traccarDeviceId: true,
          tenantId: true,
          id: true,
          associateId: true,
        },
      });

      this.deviceTenantMap.clear();
      this.deviceVehicleMap.clear();
      this.deviceAssociateMap.clear();
      for (const v of vehicles) {
        if (v.traccarDeviceId) {
          this.deviceTenantMap.set(v.traccarDeviceId, v.tenantId);
          this.deviceVehicleMap.set(v.traccarDeviceId, v.id);
          if (v.associateId) {
            this.deviceAssociateMap.set(v.traccarDeviceId, v.associateId);
          }
        }
      }

      this.logger.log(
        `Device mapping atualizado: ${this.deviceTenantMap.size} devices`,
      );
    } catch (error) {
      this.logger.error('Falha ao atualizar device mapping', error);
    }
  }

  // Refresh periódico — evita que veículos novos cadastrados após o boot
  // fiquem invisíveis no mapping (gateway sem rota de tenant) até restart.
  // Interval em ms; aceitável para 20k devices porque a query é leve (índice em deletedAt + traccarDeviceId).
  @Interval(2 * 60 * 1000)
  async scheduledMappingRefresh() {
    await this.refreshDeviceMapping();
  }

  /**
   * Contabiliza posição descartada por qualidade. Log agregado (1x por minuto
   * por device+motivo) — um rastreador sem GPS gera dezenas de posições ruins
   * por minuto e logar uma a uma afogaria o resto.
   */
  private countRejected(deviceId: number, reason?: PositionRejectReason) {
    const key = `${deviceId}:${reason ?? 'unknown'}`;
    const agora = Date.now();
    const anterior = this.rejectedPositions.get(key);
    if (anterior && agora - anterior.loggedAt < 60_000) {
      anterior.count++;
      return;
    }
    if (anterior) {
      this.logger.warn(
        `Posição descartada (${reason}) device ${deviceId}: ${anterior.count} ocorrência(s) no último minuto.`,
      );
    }
    this.rejectedPositions.set(key, { loggedAt: agora, count: 1 });
  }

  /**
   * Calcula próximo delay com backoff exponencial + jitter.
   * Min 2s, máx 60s. Evita thundering herd se Traccar reiniciar.
   */
  private nextWsBackoffMs(): number {
    const exp = Math.min(
      this.WS_BACKOFF_MAX_MS,
      this.WS_BACKOFF_MIN_MS * 2 ** this.wsReconnectAttempts,
    );
    const jitter = Math.random() * 1000;
    return Math.floor(exp + jitter);
  }

  private connectToTraccar() {
    const traccarUrl = this.configService.get<string>('traccar.url');
    const cookie = this.traccarService.getSessionCookie();

    if (!cookie) {
      const delay = this.nextWsBackoffMs();
      this.wsReconnectAttempts++;
      this.logger.warn(
        `Sem sessão Traccar, WebSocket não conectado. Retry em ${Math.round(delay / 1000)}s (tentativa #${this.wsReconnectAttempts})...`,
      );
      setTimeout(() => this.connectToTraccar(), delay);
      return;
    }

    const wsUrl = `${traccarUrl!.replace('http', 'ws')}/api/socket`;

    this.traccarWs = new WebSocket(wsUrl, {
      headers: { Cookie: cookie },
    });

    this.traccarWs.on('open', () => {
      this.logger.log(`Conectado ao Traccar WebSocket: ${wsUrl}`);
      this.wsReconnectAttempts = 0; // reset backoff em sucesso
    });

    this.traccarWs.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString());
        this.handleTraccarMessage(data);
      } catch (error) {
        this.logger.error('Erro ao processar mensagem do Traccar', error);
      }
    });

    this.traccarWs.on('close', () => {
      const delay = this.nextWsBackoffMs();
      this.wsReconnectAttempts++;
      this.logger.warn(
        `Traccar WebSocket desconectado. Reconectando em ${Math.round(delay / 1000)}s (tentativa #${this.wsReconnectAttempts})...`,
      );
      setTimeout(() => this.connectToTraccar(), delay);
    });

    this.traccarWs.on('error', (error) => {
      this.logger.error(`Traccar WebSocket erro: ${error.message}`);
    });
  }

  private handleTraccarMessage(data: TraccarWsMessage) {
    if (data.positions) {
      for (const position of data.positions) {
        // PORTÃO DE ENTRADA DO TEMPO REAL. Posição reprovada (LBS por torre,
        // fix inválido, 0,0) não pode chegar ao mapa nem ao app: seria exibida
        // como localização exata e mandaria a equipe pro lugar errado num
        // roubo. Ver docs/PLANO-PRODUCAO-ZERO-ERRO.md P0.1.
        const quality = assessPosition(position as unknown as TraccarPosition);
        if (!quality.trustworthy) {
          this.countRejected(position.deviceId, quality.reason);
          continue;
        }

        const tenantId = this.deviceTenantMap.get(position.deviceId);
        if (tenantId) {
          this.server
            .to(`tenant:${tenantId}`)
            .emit('position:update', position);

          // Processar alertas + persistir histórico em paralelo (sem bloquear emit)
          const vehicleId = this.deviceVehicleMap.get(position.deviceId);
          if (vehicleId) {
            this.alertsService
              .processPosition(position as any, vehicleId, tenantId)
              .catch((err) =>
                this.logger.error(`Erro ao processar alerta: ${err}`),
              );
            this.positionsService
              .persistIfRelevant(position as any, vehicleId, tenantId)
              .catch((err) =>
                this.logger.error(`Erro ao persistir posição: ${err}`),
              );
          }
        }

        // Espelha o mesmo update pro app do associado dono (tempo real).
        const associateId = this.deviceAssociateMap.get(position.deviceId);
        if (associateId) {
          this.server
            .to(`associate:${associateId}`)
            .emit('position:update', position);
        }
      }
    }

    if (data.devices) {
      for (const device of data.devices) {
        const tenantId = this.deviceTenantMap.get(device.id);
        if (tenantId) {
          this.server.to(`tenant:${tenantId}`).emit('device:update', device);
        }

        const associateId = this.deviceAssociateMap.get(device.id);
        if (associateId) {
          this.server
            .to(`associate:${associateId}`)
            .emit('device:update', device);
        }
      }
    }
  }
}

interface TraccarWsMessage {
  positions?: Array<{ deviceId: number; [key: string]: unknown }>;
  devices?: Array<{ id: number; [key: string]: unknown }>;
}
