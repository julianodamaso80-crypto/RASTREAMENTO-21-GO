import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from './traccar.service';
import { AlertsService } from '../alerts/alerts.service';

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

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private traccarService: TraccarService,
    private alertsService: AlertsService,
  ) {}

  async afterInit() {
    this.logger.log('WebSocket Gateway inicializado');

    // Configurar emitter de alertas para WebSocket
    this.alertsService.setEmitter((tenantId, alert) => {
      this.server.to(`tenant:${tenantId}`).emit('alert:new', alert);
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

      const tenantId = payload.tenantId;
      client.join(`tenant:${tenantId}`);
      client.data.tenantId = tenantId;
      client.data.userId = payload.sub;

      this.logger.log(`Cliente conectado: ${payload.email} (tenant: ${tenantId})`);
    } catch {
      this.logger.warn('Cliente rejeitado: token inválido');
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Cliente desconectado: ${client.data?.userId || 'unknown'}`);
  }

  async refreshDeviceMapping() {
    try {
      const vehicles = await this.prisma.vehicle.findMany({
        where: { traccarDeviceId: { not: null }, deletedAt: null },
        select: { traccarDeviceId: true, tenantId: true, id: true },
      });

      this.deviceTenantMap.clear();
      this.deviceVehicleMap.clear();
      for (const v of vehicles) {
        if (v.traccarDeviceId) {
          this.deviceTenantMap.set(v.traccarDeviceId, v.tenantId);
          this.deviceVehicleMap.set(v.traccarDeviceId, v.id);
        }
      }

      this.logger.log(`Device mapping atualizado: ${this.deviceTenantMap.size} devices`);
    } catch (error) {
      this.logger.error('Falha ao atualizar device mapping', error);
    }
  }

  private connectToTraccar() {
    const traccarUrl = this.configService.get<string>('traccar.url');
    const cookie = this.traccarService.getSessionCookie();

    if (!cookie) {
      this.logger.warn('Sem sessão Traccar, WebSocket não conectado. Retry em 30s...');
      setTimeout(() => this.connectToTraccar(), 30000);
      return;
    }

    const wsUrl = `${traccarUrl!.replace('http', 'ws')}/api/socket`;

    this.traccarWs = new WebSocket(wsUrl, {
      headers: { Cookie: cookie },
    });

    this.traccarWs.on('open', () => {
      this.logger.log(`Conectado ao Traccar WebSocket: ${wsUrl}`);
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
      this.logger.warn('Traccar WebSocket desconectado. Reconectando em 10s...');
      setTimeout(() => this.connectToTraccar(), 10000);
    });

    this.traccarWs.on('error', (error) => {
      this.logger.error(`Traccar WebSocket erro: ${error.message}`);
    });
  }

  private handleTraccarMessage(data: TraccarWsMessage) {
    if (data.positions) {
      for (const position of data.positions) {
        const tenantId = this.deviceTenantMap.get(position.deviceId);
        if (tenantId) {
          this.server.to(`tenant:${tenantId}`).emit('position:update', position);

          // Processar alertas
          const vehicleId = this.deviceVehicleMap.get(position.deviceId);
          if (vehicleId) {
            this.alertsService
              .processPosition(position as any, vehicleId, tenantId)
              .catch((err) => this.logger.error(`Erro ao processar alerta: ${err}`));
          }
        }
      }
    }

    if (data.devices) {
      for (const device of data.devices) {
        const tenantId = this.deviceTenantMap.get(device.id);
        if (tenantId) {
          this.server.to(`tenant:${tenantId}`).emit('device:update', device);
        }
      }
    }
  }
}

interface TraccarWsMessage {
  positions?: Array<{ deviceId: number; [key: string]: unknown }>;
  devices?: Array<{ id: number; [key: string]: unknown }>;
}
