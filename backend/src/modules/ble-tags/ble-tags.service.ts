import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSightingDto } from './dto/create-sighting.dto';
import { FilterSightingsDto } from './dto/filter-sightings.dto';

const BLE_DEVICE_MODELS = ['BLE_KTAG', 'BLE_REDTAG', 'BLE_AIRTAG_GENERIC'];

export type SightingEmittedPayload = {
  deviceId: string;
  deviceImei: string;
  deviceModel: string;
  vehicleId: string | null;
  sighting: {
    id: string;
    macAddress: string;
    rssi: number;
    scannerLat: number | null;
    scannerLng: number | null;
    scannerSource: string | null;
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
      include: {
        vehicle: {
          select: { id: true, plate: true, brand: true, model: true },
        },
        bleSightings: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            macAddress: true,
            rssi: true,
            scannerLat: true,
            scannerLng: true,
            scannerSource: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
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
        orderBy: { createdAt: 'desc' },
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

    const sighting = await this.sightingModel.create({
      data: {
        deviceId: device.id,
        macAddress: dto.macAddress,
        rssi: dto.rssi,
        hashedAdvKey: dto.hashedAdvKey,
        counterByte: dto.counterByte,
        scannerLat: dto.scannerLat,
        scannerLng: dto.scannerLng,
        scannerSource: dto.scannerSource,
        tenantId,
      },
    });

    await this.deviceModel.update({
      where: { id: device.id },
      data: { lastConnection: sighting.createdAt },
    });

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
          createdAt: sighting.createdAt,
        },
      });
    }

    this.logger.debug(
      `BLE sighting registrada: device=${device.id} rssi=${sighting.rssi}`,
    );

    return sighting;
  }
}
