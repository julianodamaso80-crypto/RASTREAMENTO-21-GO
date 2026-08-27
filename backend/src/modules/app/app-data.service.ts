import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertType } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  TraccarService,
  TraccarPosition,
} from '../traccar/traccar.service';
import { ReportsService, type Trip } from '../reports/reports.service';
import { ReverseGeocodeService } from '../geocoding/reverse-geocode.service';

const KNOTS_TO_KMH = 1.852;

// Alertas que NUNCA vão pro app do associado. Duas famílias:
//
// 1. Técnico interno (antifurto encoberto) — mesma regra da TAG: o que é
//    interno fica interno. GPS_SILENT segue disparando pro time interno.
// 2. Ruído puro pro dono do carro. Medido em 30 dias (ago/2026): dos 47.624
//    alertas gerados, IGNITION_ON/OFF somaram 19.931 e OFFLINE 17.819 — 79%
//    do que chegava no app era "seu carro ligou", "seu carro desligou". Quem
//    dirige o carro já sabe disso. Condução brusca é insumo de score do
//    motorista, não aviso. O que sobra aqui é o que faz o dono agir.
//
// Nada disso apaga alerta: o painel interno continua vendo tudo.
const ALERTAS_OCULTOS_DO_ASSOCIADO: AlertType[] = [
  AlertType.GPS_SILENT,
  AlertType.IGNITION_ON,
  AlertType.IGNITION_OFF,
  AlertType.OFFLINE,
  AlertType.HARSH_BRAKE,
  AlertType.HARSH_ACCEL,
  AlertType.BATTERY_LOW, // bateria do rastreador — quem troca é o técnico
];

/** Posição "limpa" pro app — só o que a UI do associado precisa. */
function toPositionDto(p: TraccarPosition) {
  const a = p.attributes ?? {};
  return {
    latitude: p.latitude,
    longitude: p.longitude,
    speed: Math.round(p.speed * KNOTS_TO_KMH), // nós → km/h
    course: p.course,
    address: p.address ?? null,
    fixTime: p.fixTime, // momento REAL do GPS (nunca confundir com heartbeat)
    ignition: a.ignition ?? null,
    motion: a.motion ?? null,
    battery: a.batteryLevel ?? null,
    // Telemetria detalhada (para a ficha do veículo no app)
    voltage: a.power ?? null, // tensão da bateria do veículo (V)
    satellites: a.sat ?? a.satellites ?? null, // nº de satélites GPS
    odometer:
      a.totalDistance != null ? Math.round(a.totalDistance / 1000) : null, // km
    powerCut: a.powerCut ?? null, // alimentação cortada (possível sabotagem)
  };
}

/**
 * Allowlist do que o associado pode ver do próprio veículo. Nunca espalhar o
 * registro do Prisma aqui: IMEI, local de instalação, técnico e estoque são
 * função de time interno e não saem por /app/* em hipótese nenhuma.
 */
function toVehicleDto(v: {
  id: string;
  plate: string;
  vehicleType: unknown;
  brand: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  status: unknown;
  traccarDeviceId: number | null;
}) {
  return {
    id: v.id,
    plate: v.plate,
    vehicleType: v.vehicleType,
    brand: v.brand,
    model: v.model,
    color: v.color,
    year: v.year,
    status: v.status,
    traccarDeviceId: v.traccarDeviceId,
  };
}

/**
 * Allowlist do que o associado pode ver de um alerta. Mesma regra do
 * toVehicleDto: dado de operação interna nunca sai por /app/*.
 */
function toAlertDto(a: {
  id: string;
  type: unknown;
  severity: unknown;
  message: string;
  status: unknown;
  read: boolean;
  createdAt: Date;
  vehicle: { id: string; plate: string };
}) {
  return {
    id: a.id,
    type: a.type,
    severity: a.severity,
    message: a.message,
    status: a.status,
    read: a.read,
    createdAt: a.createdAt,
    vehicle: { id: a.vehicle.id, plate: a.vehicle.plate },
  };
}

@Injectable()
export class AppDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly traccar: TraccarService,
    private readonly reports: ReportsService,
    private readonly geocode: ReverseGeocodeService,
  ) {}

  /** Veículos do associado + última posição + status de conexão. */
  async getVehicles(associateId: string, tenantId: string) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { associateId, tenantId, deletedAt: null },
      select: {
        id: true,
        plate: true,
        vehicleType: true, // CAR | MOTORCYCLE — define o desenho do marcador no app
        brand: true,
        model: true,
        color: true,
        year: true,
        status: true,
        traccarDeviceId: true,
      },
      orderBy: { plate: 'asc' },
    });

    const deviceIds = vehicles
      .map((v) => v.traccarDeviceId)
      .filter((id): id is number => id !== null);

    if (deviceIds.length === 0) {
      return vehicles.map((v) => ({ ...toVehicleDto(v), position: null, connection: null }));
    }

    // Posição (GPS real) e device (status de conexão = heartbeat) são fontes
    // distintas e expostas separadamente — ver regra de segurança do projeto.
    const [positions, devices] = await Promise.all([
      this.traccar.getPositions(),
      this.traccar.getDevices(),
    ]);

    const posByDevice = new Map(positions.map((p) => [p.deviceId, p]));
    const devByDevice = new Map(devices.map((d) => [d.id, d]));

    return vehicles.map((v) => {
      const pos = v.traccarDeviceId
        ? posByDevice.get(v.traccarDeviceId)
        : undefined;
      const dev = v.traccarDeviceId
        ? devByDevice.get(v.traccarDeviceId)
        : undefined;
      return {
        ...toVehicleDto(v),
        position: pos ? toPositionDto(pos) : null,
        connection: dev
          ? { status: dev.status, lastUpdate: dev.lastUpdate }
          : null,
      };
    });
  }

  /** Histórico de posições de um veículo do associado num intervalo. */
  async getHistory(
    associateId: string,
    tenantId: string,
    vehicleId: string,
    from: string,
    to: string,
  ) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, associateId, tenantId, deletedAt: null },
      select: { traccarDeviceId: true },
    });

    if (!vehicle) {
      throw new NotFoundException('Veículo não encontrado');
    }
    if (!vehicle.traccarDeviceId) {
      return [];
    }

    const positions = await this.traccar.getPositions(
      vehicle.traccarDeviceId,
      from,
      to,
    );
    return positions.map(toPositionDto);
  }

  /**
   * Trajetos do veículo no período — a aba que substituiu "Alertas" no app.
   *
   * Viagem só existe onde houve movimento de verdade (o corte é do
   * ReportsService, por velocidade). Rastreador que ficou repetindo a mesma
   * coordenada em heartbeat não gera viagem nenhuma — e é isso que o app usa
   * pra dizer "seu carro não saiu do lugar desde X" em vez de exibir contagem
   * de pontos que parece movimento.
   */
  async getTrips(
    associateId: string,
    tenantId: string,
    vehicleId: string,
    from: string,
    to: string,
  ) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, associateId, tenantId, deletedAt: null },
      select: { traccarDeviceId: true },
    });

    if (!vehicle) {
      throw new NotFoundException('Veículo não encontrado');
    }
    if (!vehicle.traccarDeviceId) {
      return [];
    }

    const trips = await this.reports.getTrips(
      vehicle.traccarDeviceId,
      from,
      to,
    );
    if (trips.length === 0) return [];

    const enderecos = await this.enderecosDasPontas(trips);

    return trips
      .map((t) => ({
        id: t.startTime,
        startTime: t.startTime,
        endTime: t.endTime,
        startLat: t.startLat,
        startLng: t.startLng,
        endLat: t.endLat,
        endLng: t.endLng,
        startAddress: this.endereco(enderecos, t.startLat, t.startLng),
        endAddress: this.endereco(enderecos, t.endLat, t.endLng),
        distanceKm: t.distance,
        durationMin: t.duration,
        maxSpeed: t.maxSpeed,
      }))
      .sort((a, b) => b.startTime.localeCompare(a.startTime));
  }

  /**
   * Endereço das duas pontas de cada viagem numa tacada só. Em lote porque o
   * geocoder tem portão de 1 req/s: pedir ponto a ponto faria a aba abrir em
   * dezenas de segundos.
   */
  private async enderecosDasPontas(trips: Trip[]): Promise<Map<string, string>> {
    const coordenadas = trips.flatMap((t) => [
      { latitude: t.startLat, longitude: t.startLng },
      { latitude: t.endLat, longitude: t.endLng },
    ]);
    return this.geocode.lookupCached(coordenadas);
  }

  private endereco(
    enderecos: Map<string, string>,
    latitude: number,
    longitude: number,
  ): string | null {
    const chave = this.geocode.chave({ latitude, longitude });
    return (chave && enderecos.get(chave)) || null;
  }

  /** Alertas dos veículos do associado, mais recentes primeiro. */
  async getAlerts(associateId: string, tenantId: string, limit = 50) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { associateId, tenantId, deletedAt: null },
      select: { id: true },
    });
    const vehicleIds = vehicles.map((v) => v.id);
    if (vehicleIds.length === 0) return [];

    const alerts = await this.prisma.alert.findMany({
      where: {
        vehicleId: { in: vehicleIds },
        tenantId,
        deletedAt: null,
        type: { notIn: ALERTAS_OCULTOS_DO_ASSOCIADO },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        type: true,
        severity: true,
        message: true,
        status: true,
        read: true,
        createdAt: true,
        vehicle: { select: { id: true, plate: true } },
      },
    });
    return alerts.map(toAlertDto);
  }
}
