import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

// Portas Traccar por protocolo/modelo
export const TRACCAR_PORTS: Record<string, { port: number; protocol: string }> = {
  GT06N: { port: 5023, protocol: 'gt06' },
  GT06: { port: 5023, protocol: 'gt06' },
  CONCOX_GT06N: { port: 5023, protocol: 'gt06' },
  ST310U: { port: 5011, protocol: 'suntech' },
  ST340: { port: 5011, protocol: 'suntech' },
  ST350: { port: 5011, protocol: 'suntech' },
  J16: { port: 5023, protocol: 'gt06' },
  J16_PRO: { port: 5023, protocol: 'gt06' },
  CRX3: { port: 5023, protocol: 'gt06' },
  CRX3_NANO: { port: 5023, protocol: 'gt06' },
  CRX_PRO_4G: { port: 5023, protocol: 'gt06' },
  TK103: { port: 5001, protocol: 'gps103' },
  TK303: { port: 5001, protocol: 'gps103' },
  COBAN_GPS103: { port: 5001, protocol: 'gps103' },
  FMB920: { port: 5027, protocol: 'teltonika' },
  FMB120: { port: 5027, protocol: 'teltonika' },
  SINOTRACK_ST901: { port: 5013, protocol: 'h02' },
  SINOTRACK_ST905: { port: 5013, protocol: 'h02' },
  OTHER: { port: 5055, protocol: 'osmand' },
};

interface CommandTemplate {
  type: string;
  label: string;
  template: string;
  step: number;
}

// Templates de comandos SMS por família de rastreador
const COMMAND_TEMPLATES: Record<string, CommandTemplate[]> = {
  // GT06/GT06N/Concox/J16/CRX (protocolo similar)
  gt06: [
    { type: 'SET_TIMEZONE', label: 'Configurar Fuso Horário', template: 'GMT,W,0,0#', step: 1 },
    { type: 'SET_APN', label: 'Configurar APN', template: 'APN,{apn},{apnUser},{apnPass}#', step: 2 },
    { type: 'SET_SERVER_IP', label: 'Configurar Servidor Primário', template: 'SERVER,1,{ip},{port},0#', step: 3 },
    { type: 'SET_SECONDARY_IP', label: 'Configurar Servidor Secundário', template: 'SERVER,2,{secondaryIp},{port},0#', step: 4 },
    { type: 'SET_TIMER', label: 'Configurar Intervalo de Envio', template: 'TIMER,30,3600#', step: 5 },
    { type: 'RESTART', label: 'Reiniciar Rastreador', template: 'RESET#', step: 6 },
    { type: 'BLOCK', label: 'Bloquear Veículo', template: 'RELAY,1#', step: 0 },
    { type: 'UNBLOCK', label: 'Desbloquear Veículo', template: 'RELAY,0#', step: 0 },
    { type: 'GET_PARAMS', label: 'Ver Configurações Atuais', template: 'PARAM#', step: 0 },
    { type: 'GET_LOCATION', label: 'Solicitar Localização', template: 'WHERE#', step: 0 },
  ],
  // CRX3/CRX3 NANO/CRX PRO
  crx: [
    { type: 'SET_APN', label: 'Configurar APN', template: 'APN#{apn},{apnUser},{apnPass}', step: 1 },
    { type: 'SET_SERVER_IP', label: 'Configurar Servidor', template: 'IP#{ip}:{port}', step: 2 },
    { type: 'SET_TIMER', label: 'Configurar Intervalo de Envio', template: 'TIMER#30,3600', step: 3 },
    { type: 'RESTART', label: 'Reiniciar Rastreador', template: 'RESET#', step: 4 },
    { type: 'BLOCK', label: 'Bloquear Veículo', template: 'OUT1#ON', step: 0 },
    { type: 'UNBLOCK', label: 'Desbloquear Veículo', template: 'OUT1#OFF', step: 0 },
  ],
  // Suntech ST310U/ST340/ST350
  suntech: [
    { type: 'SET_TIMEZONE', label: 'Configurar Fuso Horário', template: 'SA200TMZ;{imei};-3', step: 1 },
    { type: 'SET_APN', label: 'Configurar APN', template: 'SA200NTW;{imei};01;{apn};{apnUser};{apnPass}', step: 2 },
    { type: 'SET_SERVER_IP', label: 'Configurar IP do Servidor', template: 'SA200NTW;{imei};02;{ip};{port}', step: 3 },
    { type: 'SET_TIMER', label: 'Configurar Intervalo de Envio', template: 'SA200RPT;{imei};30;3600', step: 4 },
  ],
  // TK103/TK303/Coban GPS103
  gps103: [
    { type: 'SET_APN', label: 'Configurar APN', template: 'apn123456 {apn}', step: 1 },
    { type: 'SET_SERVER_IP', label: 'Configurar IP do Servidor', template: 'adminip123456 {ip} {port}', step: 2 },
    { type: 'RESTART', label: 'Reiniciar Rastreador', template: 'reset123456', step: 3 },
    { type: 'BLOCK', label: 'Bloquear Veículo', template: 'stop123456', step: 0 },
    { type: 'UNBLOCK', label: 'Desbloquear Veículo', template: 'resume123456', step: 0 },
    { type: 'GET_LOCATION', label: 'Solicitar Localização', template: 'fix030s***n123456', step: 0 },
  ],
  // Teltonika FMB920/FMB120
  teltonika: [
    { type: 'SET_APN', label: 'Configurar APN', template: 'setparam 2001:{apn};2002:{apnUser};2003:{apnPass}', step: 1 },
    { type: 'SET_SERVER_IP', label: 'Configurar IP do Servidor', template: 'setparam 2004:{ip};2005:{port};2006:0', step: 2 },
    { type: 'SET_TIMER', label: 'Configurar Intervalo de Envio', template: 'setparam 10050:30;10150:30;10250:30', step: 3 },
  ],
  // Sinotrack H02
  h02: [
    { type: 'SET_APN', label: 'Configurar APN', template: '805{apn}', step: 1 },
    { type: 'SET_SERVER_IP', label: 'Configurar IP do Servidor', template: '804{ip} {port}', step: 2 },
    { type: 'SET_TIMER', label: 'Configurar Intervalo de Envio', template: '805030', step: 3 },
    { type: 'BLOCK', label: 'Bloquear Veículo', template: '200', step: 0 },
    { type: 'UNBLOCK', label: 'Desbloquear Veículo', template: '201', step: 0 },
    { type: 'GET_LOCATION', label: 'Solicitar Localização', template: '666', step: 0 },
  ],
};

// Mapa de modelo para família de template
const MODEL_TO_FAMILY: Record<string, string> = {
  GT06N: 'gt06',
  GT06: 'gt06',
  CONCOX_GT06N: 'gt06',
  J16: 'gt06',
  J16_PRO: 'gt06',
  CRX3: 'crx',
  CRX3_NANO: 'crx',
  CRX_PRO_4G: 'crx',
  ST310U: 'suntech',
  ST340: 'suntech',
  ST350: 'suntech',
  TK103: 'gps103',
  TK303: 'gps103',
  COBAN_GPS103: 'gps103',
  FMB920: 'teltonika',
  FMB120: 'teltonika',
  SINOTRACK_ST901: 'h02',
  SINOTRACK_ST905: 'h02',
  OTHER: 'gt06',
};

@Injectable()
export class SmsCommandsService {
  private readonly logger = new Logger(SmsCommandsService.name);

  private get smsModel() {
    return (this.prisma as any).smsCommand;
  }
  private get deviceModel() {
    return (this.prisma as any).device;
  }

  constructor(private prisma: PrismaService) {}

  // DNS hostnames (preferencial — rastreadores modernos)
  getServerHostname(): string {
    return process.env.SERVER_HOSTNAME || '';
  }

  getBackupHostname(): string {
    return process.env.SERVER_HOSTNAME_BACKUP || '';
  }

  // IPs (fallback — rastreadores antigos que não suportam DNS)
  getServerIp(): string {
    return process.env.SERVER_PRIMARY_IP || '0.0.0.0';
  }

  getSecondaryIp(): string {
    return process.env.SERVER_SECONDARY_IP || '0.0.0.0';
  }

  // Retorna hostname se disponível, senão IP (usado nos templates SMS)
  getServerAddress(): string {
    return this.getServerHostname() || this.getServerIp();
  }

  getSecondaryAddress(): string {
    return this.getBackupHostname() || this.getSecondaryIp();
  }

  getPortForModel(model: string): { port: number; protocol: string } {
    return TRACCAR_PORTS[model] || TRACCAR_PORTS.OTHER;
  }

  getTemplateFamily(model: string): string {
    return MODEL_TO_FAMILY[model] || 'gt06';
  }

  async generateCommands(deviceId: string, tenantId: string, type?: string) {
    const device = await this.deviceModel.findFirst({
      where: { id: deviceId, tenantId, deletedAt: null },
      include: { chip: true },
    });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');

    const family = this.getTemplateFamily(device.model);
    const portInfo = this.getPortForModel(device.model);
    // Usa hostname DNS quando disponível (preferencial)
    const ip = this.getServerAddress();
    const secondaryIp = this.getSecondaryAddress();

    let templates = COMMAND_TEMPLATES[family] || COMMAND_TEMPLATES.gt06;

    if (type) {
      templates = templates.filter((t) => t.type === type);
    } else {
      // Apenas comandos de configuração inicial (step > 0)
      templates = templates.filter((t) => t.step > 0).sort((a, b) => a.step - b.step);
    }

    const apn = device.chip?.apn || '';
    const apnUser = device.chip?.apnUser || '';
    const apnPass = device.chip?.apnPassword || '';
    const phoneNumber = device.chip?.phoneNumber || '';

    const commands = templates.map((t) => {
      let command = t.template
        .replace('{ip}', ip)
        .replace('{secondaryIp}', secondaryIp)
        .replace('{port}', String(portInfo.port))
        .replace('{apn}', apn)
        .replace('{apnUser}', apnUser)
        .replace('{apnPass}', apnPass)
        .replace('{imei}', device.imei);

      return {
        step: t.step,
        type: t.type,
        label: t.label,
        command,
        phoneNumber,
        protocol: portInfo.protocol,
        port: portInfo.port,
      };
    });

    // Verifica se o modelo suporta múltiplos IPs (J16/GT06 family)
    const supportsMultiIp = ['gt06'].includes(family);

    return {
      device: { id: device.id, imei: device.imei, model: device.model },
      chip: device.chip
        ? { id: device.chip.id, phoneNumber, operator: device.chip.operator, apn }
        : null,
      serverHostname: this.getServerHostname(),
      backupHostname: this.getBackupHostname(),
      serverIp: this.getServerIp(),
      secondaryIp: this.getSecondaryIp(),
      serverPort: portInfo.port,
      protocol: portInfo.protocol,
      supportsMultiIp,
      commands,
    };
  }

  async sendCommand(
    deviceId: string,
    tenantId: string,
    userId: string,
    userRole: string,
    type: string,
    customCommand?: string,
  ) {
    // FACTORY_RESET apenas para ADMIN
    if (type === 'FACTORY_RESET' && userRole !== 'SUPER_ADMIN' && userRole !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem executar reset de fábrica');
    }

    const generated = await this.generateCommands(deviceId, tenantId, type);
    const commandText = customCommand || (generated.commands[0]?.command ?? '');

    if (!commandText) throw new NotFoundException('Template de comando não encontrado para este modelo');

    const smsCommand = await this.smsModel.create({
      data: {
        deviceId,
        command: commandText,
        type,
        status: 'PENDING',
        sentBy: userId,
        tenantId,
      },
    });

    this.logger.log(
      `Comando ${type} criado para device ${deviceId}: ${commandText} (por ${userId})`,
    );

    return smsCommand;
  }

  async getHistory(deviceId: string, tenantId: string, query: PaginationQueryDto) {
    const { page, perPage } = query;

    // Verificar que device pertence ao tenant
    const device = await this.deviceModel.findFirst({
      where: { id: deviceId, tenantId, deletedAt: null },
    });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');

    const where = { deviceId };

    const [data, total] = await Promise.all([
      this.smsModel.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.smsModel.count({ where }),
    ]);

    return { data, meta: { total, page, perPage } };
  }

  getAllTemplates() {
    return Object.entries(COMMAND_TEMPLATES).map(([family, templates]) => ({
      family,
      models: Object.entries(MODEL_TO_FAMILY)
        .filter(([, f]) => f === family)
        .map(([m]) => m),
      templates: templates.map((t) => ({
        type: t.type,
        label: t.label,
        template: t.template,
        isSetup: t.step > 0,
      })),
    }));
  }
}
