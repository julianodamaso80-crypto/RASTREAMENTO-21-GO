import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import { ReverseGeocodeService } from '../geocoding/reverse-geocode.service';

/** Durações que o botão oferece, em horas. */
export const DURACOES_HORAS = [1, 8, 24, 48] as const;
/** Links ativos ao mesmo tempo por veículo: clique repetido não espalha dezenas. */
const MAX_ATIVOS_POR_VEICULO = 10;
const KNOTS_TO_KMH = 1.852;

export interface Solicitante {
  origem: 'PAINEL' | 'APP';
  userId?: string;
  associateId?: string;
  nome?: string | null;
}

export function linkDaLocalizacao(token: string): string {
  const base = (process.env.PUBLIC_SITE_URL || 'https://trackgo.site').replace(/\/$/, '');
  return `${base}/localizacao/${token}`;
}

type Registro = {
  id: string;
  plate: string;
  hours: number;
  source: string;
  requestedByName: string | null;
  token: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

@Injectable()
export class LocationSharesService {
  constructor(
    private prisma: PrismaService,
    private traccar: TraccarService,
    private geocode: ReverseGeocodeService,
  ) {}

  private paraTela(r: Registro, comQuemPediu: boolean) {
    const agora = Date.now();
    return {
      id: r.id,
      plate: r.plate,
      hours: r.hours,
      source: r.source,
      requestedByName: comQuemPediu ? r.requestedByName : null,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
      active: !r.revokedAt && r.expiresAt.getTime() > agora,
      url: linkDaLocalizacao(r.token),
    };
  }

  /** Veículo do tenant; no app, só o do próprio associado. */
  private async veiculo(tenantId: string, vehicleId: string, s: Solicitante) {
    if (!tenantId) throw new UnauthorizedException('Empresa não identificada');
    if (s.origem === 'APP' && !s.associateId) {
      throw new UnauthorizedException('Associado não identificado');
    }
    const v = await this.prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        tenantId,
        deletedAt: null,
        ...(s.origem === 'APP' ? { associateId: s.associateId } : {}),
      },
      select: { id: true, plate: true, traccarDeviceId: true },
    });
    if (!v) throw new NotFoundException('Veículo não encontrado');
    return v;
  }

  async criar(tenantId: string, vehicleId: string, horas: number, s: Solicitante) {
    if (!DURACOES_HORAS.includes(horas as (typeof DURACOES_HORAS)[number])) {
      throw new BadRequestException(`Escolha ${DURACOES_HORAS.join(', ')} horas`);
    }
    const v = await this.veiculo(tenantId, vehicleId, s);
    if (!v.traccarDeviceId) {
      throw new BadRequestException('Este veículo ainda não tem rastreador vinculado');
    }
    const ativos = await this.prisma.locationShare.count({
      where: { tenantId, vehicleId: v.id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (ativos >= MAX_ATIVOS_POR_VEICULO) {
      throw new BadRequestException(
        'Este veículo já tem 10 links ativos. Cancele algum antes de gerar outro.',
      );
    }
    const r = await this.prisma.locationShare.create({
      data: {
        tenantId,
        vehicleId: v.id,
        plate: v.plate,
        hours: horas,
        source: s.origem,
        requestedByUserId: s.userId ?? null,
        requestedByAssociateId: s.associateId ?? null,
        requestedByName: s.nome ?? null,
        token: randomBytes(32).toString('base64url'),
        expiresAt: new Date(Date.now() + horas * 3_600_000),
      },
    });
    return this.paraTela(r, s.origem === 'PAINEL');
  }

  /** Links do veículo. O associado vê só os que ele mesmo gerou. */
  async listar(tenantId: string, vehicleId: string, s: Solicitante) {
    const v = await this.veiculo(tenantId, vehicleId, s);
    const lista = await this.prisma.locationShare.findMany({
      where: {
        tenantId,
        vehicleId: v.id,
        ...(s.origem === 'APP' ? { requestedByAssociateId: s.associateId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return lista.map((r) => this.paraTela(r, s.origem === 'PAINEL'));
  }

  async cancelar(tenantId: string, id: string, s: Solicitante) {
    if (!tenantId) throw new UnauthorizedException('Empresa não identificada');
    if (s.origem === 'APP' && !s.associateId) {
      throw new UnauthorizedException('Associado não identificado');
    }
    const r = await this.prisma.locationShare.findFirst({
      where: {
        id,
        tenantId,
        ...(s.origem === 'APP' ? { requestedByAssociateId: s.associateId } : {}),
      },
    });
    if (!r) throw new NotFoundException('Link não encontrado');
    const atualizado = r.revokedAt
      ? r
      : await this.prisma.locationShare.update({
          where: { id: r.id },
          data: { revokedAt: new Date() },
        });
    return this.paraTela(atualizado, s.origem === 'PAINEL');
  }

  /**
   * O que a página pública mostra. Só o necessário para achar o veículo:
   * nada de dono, IMEI, local de instalação ou empresa.
   */
  async publico(token: string) {
    if (!token || token.length < 40 || token.length > 64) {
      throw new NotFoundException('Link não encontrado');
    }
    const r = await this.prisma.locationShare.findFirst({ where: { token } });
    if (!r) throw new NotFoundException('Link não encontrado');
    if (r.revokedAt || r.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('Este link de localização expirou');
    }
    const v = await this.prisma.vehicle.findFirst({
      where: { id: r.vehicleId, tenantId: r.tenantId, deletedAt: null },
      select: {
        plate: true,
        brand: true,
        model: true,
        color: true,
        vehicleType: true,
        traccarDeviceId: true,
        associateId: true,
      },
    });
    if (!v) throw new GoneException('Este link de localização expirou');
    // Link do associado morre na troca de titularidade: o dono antigo não
    // acompanha o veículo de quem comprou.
    if (r.requestedByAssociateId && v.associateId !== r.requestedByAssociateId) {
      throw new GoneException('Este link de localização expirou');
    }

    let position: null | {
      latitude: number;
      longitude: number;
      speed: number;
      course: number;
      fixTime: string;
      ignition: boolean | null;
      address: string | null;
    } = null;
    let lastUpdate: string | null = null;
    if (v.traccarDeviceId) {
      const devices = await this.traccar.getDevicesPorIds([v.traccarDeviceId]);
      lastUpdate = devices[0]?.lastUpdate ?? null;
      const [p] = await this.traccar.getPositionsDosDevices([v.traccarDeviceId], devices);
      // 0/0 é o rastreador sem satélite, não um lugar.
      if (p && (p.latitude !== 0 || p.longitude !== 0)) {
        const coord = { latitude: p.latitude, longitude: p.longitude };
        position = {
          latitude: p.latitude,
          longitude: p.longitude,
          speed: Math.round(p.speed * KNOTS_TO_KMH),
          course: p.course,
          fixTime: p.fixTime,
          ignition: p.attributes?.ignition ?? null,
          address: await this.geocode.lookupNow(coord).catch(() => null),
        };
      }
    }

    return {
      plate: v.plate,
      brand: v.brand,
      model: v.model,
      color: v.color,
      vehicleType: v.vehicleType,
      expiresAt: r.expiresAt.toISOString(),
      lastUpdate,
      position,
    };
  }
}
