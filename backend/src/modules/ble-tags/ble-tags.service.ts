import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSightingDto } from './dto/create-sighting.dto';
import { FilterSightingsDto } from './dto/filter-sightings.dto';
import { decidirModo, ModoPolling, TURBO_MANUAL_H } from './polling-mode';

const BLE_DEVICE_MODELS = ['BLE_KTAG', 'BLE_REDTAG', 'BLE_AIRTAG_GENERIC'];

// Chave privada da TAG: nunca pode voltar em listagem. Só sai do banco pela
// rota de plano de polling (getPollingPlan), que escolhe os campos a dedo.
const OMIT_BLE_KEY = {
  bleAdvKeyPrivate: true,
  bleAdvKeyHashed: true,
} as const;

export type SightingEmittedPayload = {
  deviceId: string;
  deviceImei: string;
  deviceModel: string;
  vehicleId: string | null;
  sighting: {
    id: string;
    macAddress: string;
    rssi: number | null;
    scannerLat: number | null;
    scannerLng: number | null;
    scannerSource: string | null;
    seenAt: Date;
    accuracy: number | null;
    createdAt: Date;
  };
};

type SightingEmitter = (
  tenantId: string,
  payload: SightingEmittedPayload,
) => void;

@Injectable()
export class BleTagsService {
  private readonly logger = new Logger(BleTagsService.name);
  private emitter: SightingEmitter | null = null;

  private get deviceModel() {
    return (this.prisma as any).device;
  }

  private get sightingModel() {
    return (this.prisma as any).bleSighting;
  }

  private get alertModel() {
    return (this.prisma as any).alert;
  }

  constructor(private prisma: PrismaService) {}

  setEmitter(emitter: SightingEmitter) {
    this.emitter = emitter;
  }

  async findAll(tenantId: string) {
    return this.deviceModel.findMany({
      where: {
        tenantId,
        deletedAt: null,
        model: { in: BLE_DEVICE_MODELS },
      },
      omit: OMIT_BLE_KEY,
      include: {
        vehicle: {
          select: { id: true, plate: true, brand: true, model: true },
        },
        bleSightings: {
          take: 1,
          orderBy: { seenAt: 'desc' },
          select: {
            id: true,
            macAddress: true,
            rssi: true,
            scannerLat: true,
            scannerLng: true,
            scannerSource: true,
            seenAt: true,
            accuracy: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * TAGs em uso: vinculadas a um veículo e ainda instaladas.
   *
   * É a régua de "Clientes Ativos" aplicada à TAG — quem foi retirado
   * (`uninstalledAt`) ou nunca foi instalado não conta como ativo. Traz o
   * cliente junto porque a tela existe pro atendimento, que precisa saber de
   * quem é a TAG antes de qualquer outra coisa.
   */
  async findActive(tenantId: string) {
    return this.deviceModel.findMany({
      where: {
        tenantId,
        deletedAt: null,
        model: { in: BLE_DEVICE_MODELS },
        vehicleId: { not: null },
        uninstalledAt: null,
      },
      omit: OMIT_BLE_KEY,
      include: {
        vehicle: {
          select: {
            id: true,
            plate: true,
            brand: true,
            model: true,
            vehicleType: true,
            associate: { select: { id: true, name: true, cpf: true } },
          },
        },
        installedByTechnician: { select: { id: true, name: true } },
        bleSightings: {
          take: 1,
          orderBy: { seenAt: 'desc' },
          select: {
            id: true,
            macAddress: true,
            rssi: true,
            scannerLat: true,
            scannerLng: true,
            scannerSource: true,
            seenAt: true,
            accuracy: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ installedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string, tenantId: string) {
    const tag = await this.deviceModel.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
        model: { in: BLE_DEVICE_MODELS },
      },
      omit: OMIT_BLE_KEY,
      include: {
        vehicle: {
          select: { id: true, plate: true, brand: true, model: true },
        },
      },
    });
    if (!tag) throw new NotFoundException('TAG BLE não encontrada');
    return tag;
  }

  async listSightings(
    deviceId: string,
    tenantId: string,
    filters: FilterSightingsDto,
  ) {
    await this.findOne(deviceId, tenantId);

    const { page, perPage } = filters;
    const where = { deviceId, tenantId };

    const [data, total] = await Promise.all([
      this.sightingModel.findMany({
        where,
        orderBy: { seenAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.sightingModel.count({ where }),
    ]);

    return { data, meta: { total, page, perPage } };
  }

  async createSighting(dto: CreateSightingDto, tenantId: string) {
    const device = await this.deviceModel.findFirst({
      where: {
        imei: dto.deviceImei,
        tenantId,
        deletedAt: null,
      },
    });

    if (!device) {
      throw new NotFoundException(
        'TAG BLE não encontrada (IMEI inexistente ou pertence a outro tenant)',
      );
    }

    if (!BLE_DEVICE_MODELS.includes(device.model)) {
      throw new BadRequestException(
        'Device informado não é uma TAG BLE (model precisa ser BLE_KTAG, BLE_REDTAG ou BLE_AIRTAG_GENERIC)',
      );
    }

    const seenAt = dto.seenAt ? new Date(dto.seenAt) : new Date();

    // Restart do worker no meio de um backfill reenvia a mesma janela de até
    // 7 dias; sem índice único (um P2002 apareceria pro worker como 500, que
    // ele trata como falha transiente e reenvia pra sempre), o dedupe é feito
    // aqui, por aplicação (ver I3).
    if (dto.hashedAdvKey) {
      const existente = await this.sightingModel.findFirst({
        where: {
          deviceId: device.id,
          hashedAdvKey: dto.hashedAdvKey,
          seenAt,
        },
      });
      if (existente) return existente;
    }

    const sighting = await this.sightingModel.create({
      data: {
        deviceId: device.id,
        macAddress: dto.macAddress,
        rssi: dto.rssi ?? null,
        accuracy: dto.accuracy ?? null,
        seenAt,
        hashedAdvKey: dto.hashedAdvKey,
        counterByte: dto.counterByte,
        scannerLat: dto.scannerLat,
        scannerLng: dto.scannerLng,
        scannerSource: dto.scannerSource,
        tenantId,
      },
    });

    // Backfill entrega relatos fora de ordem (até 7 dias de história); só
    // avança lastConnection, nunca retrocede pra um seenAt mais antigo que o
    // já registrado (ver I2).
    if (!device.lastConnection || seenAt > device.lastConnection) {
      await this.deviceModel.update({
        where: { id: device.id },
        data: { lastConnection: seenAt },
      });
    }

    if (this.emitter) {
      this.emitter(tenantId, {
        deviceId: device.id,
        deviceImei: device.imei,
        deviceModel: device.model,
        vehicleId: device.vehicleId ?? null,
        sighting: {
          id: sighting.id,
          macAddress: sighting.macAddress,
          rssi: sighting.rssi,
          scannerLat: sighting.scannerLat,
          scannerLng: sighting.scannerLng,
          scannerSource: sighting.scannerSource,
          seenAt: sighting.seenAt,
          accuracy: sighting.accuracy,
          createdAt: sighting.createdAt,
        },
      });
    }

    this.logger.debug(
      `BLE sighting registrada: device=${device.id} rssi=${sighting.rssi}`,
    );

    return sighting;
  }

  /**
   * O que o worker deve buscar e com que pressa. Toda a regra de ritmo mora
   * aqui: o worker não conhece alerta nem veículo, só obedece o intervalo.
   *
   * `agora` é injetável para o teste não depender do relógio da máquina.
   */
  async getPollingPlan(tenantId: string, agora: Date = new Date()) {
    const tags = await this.deviceModel.findMany({
      where: {
        tenantId,
        deletedAt: null,
        model: { in: BLE_DEVICE_MODELS },
      },
      select: {
        imei: true,
        vehicleId: true,
        bleAdvKeyPrivate: true,
        bleAdvKeyHashed: true,
        bleTurboUntil: true,
      },
    });

    const comChave = tags.filter(
      (t: any) => t.bleAdvKeyPrivate && t.bleAdvKeyHashed,
    );
    if (comChave.length === 0) return { tags: [] };

    const alertas = await this.alertModel.findMany({
      where: {
        tenantId,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        vehicleId: {
          in: comChave.map((t: any) => t.vehicleId).filter(Boolean),
        },
      },
      select: { vehicleId: true, type: true },
    });

    const porVeiculo = new Map<string, string[]>();
    for (const a of alertas) {
      const lista = porVeiculo.get(a.vehicleId) ?? [];
      lista.push(a.type);
      porVeiculo.set(a.vehicleId, lista);
    }

    // TAG em repouso (IDLE) não entra no plano: com 52 mil TAGs, mandar o
    // worker consultar a frota inteira em ritmo lento ainda é o padrão que
    // bane a conta na Apple. Só quem tem ocorrência aberta custa requisição.
    const tagsParaConsultar = comChave
      .map((t: any) => {
        const decisao = decidirModo({
          alertasAbertos: t.vehicleId
            ? (porVeiculo.get(t.vehicleId) ?? [])
            : [],
          turboUntil: t.bleTurboUntil,
          agora,
        });
        return {
          deviceImei: t.imei,
          privateKey: t.bleAdvKeyPrivate,
          hashedAdvKey: t.bleAdvKeyHashed,
          mode: decisao.modo as ModoPolling,
          intervalSeconds: decisao.intervalSeconds,
          backfillHours: decisao.backfillHours,
        };
      })
      .filter((t: any) => t.mode === 'TURBO');

    return { tags: tagsParaConsultar };
  }

  /**
   * Liga o ritmo acelerado por decisão do operador — para o caso em que a
   * suspeita chega por telefone antes de qualquer alerta automático.
   */
  async acionarTurbo(id: string, tenantId: string, agora: Date = new Date()) {
    await this.findOne(id, tenantId);

    const bleTurboUntil = new Date(
      agora.getTime() + TURBO_MANUAL_H * 60 * 60 * 1000,
    );

    await this.deviceModel.update({
      where: { id },
      data: { bleTurboUntil },
    });

    this.logger.log(
      `Ritmo acelerado ligado na TAG ${id} até ${bleTurboUntil.toISOString()}`,
    );

    return { bleTurboUntil };
  }
}
