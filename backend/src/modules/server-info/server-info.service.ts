import { Injectable, Logger } from '@nestjs/common';
import { TraccarService } from '../traccar/traccar.service';
import { TRACCAR_PORTS } from '../sms-commands/sms-commands.service';

const PROTOCOL_INFO: Record<string, { name: string; models: string[] }> = {
  gt06: { name: 'GT06', models: ['GT06', 'GT06N', 'Concox', 'J16', 'J16 Pro'] },
  osmand: { name: 'OsmAnd', models: ['App OsmAnd (teste)'] },
  suntech: { name: 'Suntech', models: ['ST310U', 'ST340', 'ST350'] },
  teltonika: { name: 'Teltonika', models: ['FMB920', 'FMB120'] },
  h02: { name: 'H02', models: ['Sinotrack ST901', 'ST905'] },
  gps103: { name: 'GPS103', models: ['TK103', 'TK303', 'Coban'] },
};

@Injectable()
export class ServerInfoService {
  private readonly logger = new Logger(ServerInfoService.name);

  constructor(private traccarService: TraccarService) {}

  async getServerInfo() {
    // Hostnames DNS (campo principal)
    const hostname = process.env.SERVER_HOSTNAME || '';
    const backupHostname = process.env.SERVER_HOSTNAME_BACKUP || '';
    const maintenanceHostname = process.env.SERVER_HOSTNAME_MAINTENANCE || '';

    // IPs (fallback pra rastreadores antigos)
    const primaryIp = process.env.SERVER_PRIMARY_IP || '0.0.0.0';
    const secondaryIp = process.env.SERVER_SECONDARY_IP || '0.0.0.0';
    const maintenanceIp = process.env.SERVER_MAINTENANCE_IP || '0.0.0.0';

    let traccarInfo = null;
    try {
      const server = await this.traccarService.getServer();
      traccarInfo = {
        version: server?.version || 'unknown',
        status: 'online',
      };
    } catch {
      traccarInfo = { version: 'unknown', status: 'offline' };
    }

    // Portas por protocolo únicas
    const portSet = new Map<number, { protocol: string; name: string; models: string[] }>();
    for (const [, info] of Object.entries(TRACCAR_PORTS)) {
      if (!portSet.has(info.port)) {
        const protoInfo = PROTOCOL_INFO[info.protocol];
        portSet.set(info.port, {
          protocol: info.protocol,
          name: protoInfo?.name || info.protocol,
          models: protoInfo?.models || [],
        });
      }
    }

    const ports = Array.from(portSet.entries())
      .map(([port, info]) => ({
        port,
        protocol: info.name,
        models: info.models,
        status: 'active',
      }))
      .sort((a, b) => a.port - b.port);

    return {
      hostname,
      backupHostname,
      maintenanceHostname,
      ip: primaryIp,
      primaryIp,
      secondaryIp,
      maintenanceIp,
      traccar: traccarInfo,
      ports,
    };
  }
}
