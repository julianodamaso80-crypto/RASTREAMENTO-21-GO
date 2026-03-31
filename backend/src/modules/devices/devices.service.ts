import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { FilterDevicesDto } from './dto/filter-devices.dto';

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  private get deviceModel() {
    return (this.prisma as any).device;
  }

  constructor(
    private prisma: PrismaService,
    private traccarService: TraccarService,
  ) {}

  async findAll(tenantId: string, filters: FilterDevicesDto) {
    const { page, perPage, status, model, search } = filters;
    const where: any = { tenantId, deletedAt: null };

    if (status) where.status = status;
    if (model) where.model = model;
    if (search) {
      where.OR = [
        { imei: { contains: search, mode: 'insensitive' } },
        { vehicle: { plate: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.deviceModel.findMany({
        where,
        include: {
          chip: { select: { id: true, iccid: true, phoneNumber: true, operator: true, status: true, apn: true } },
          vehicle: { select: { id: true, plate: true, brand: true, model: true } },
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.deviceModel.count({ where }),
    ]);

    return { data, meta: { total, page, perPage } };
  }

  async findOne(id: string, tenantId: string) {
    const device = await this.deviceModel.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        chip: true,
        vehicle: { include: { associate: { select: { id: true, name: true, cpf: true, phone: true } } } },
        smsCommands: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');
    return device;
  }

  async create(dto: CreateDeviceDto, tenantId: string) {
    const existing = await this.deviceModel.findFirst({ where: { imei: dto.imei } });
    if (existing) throw new ConflictException('IMEI já cadastrado');

    const data: any = {
      imei: dto.imei,
      model: dto.model,
      brand: dto.brand,
      firmwareVersion: dto.firmwareVersion,
      serialNumber: dto.serialNumber,
      notes: dto.notes,
      installedBy: dto.installedBy,
      tenantId,
    };

    if (dto.vehicleId) data.vehicleId = dto.vehicleId;
    if (dto.chipId) data.chipId = dto.chipId;

    const device = await this.deviceModel.create({ data });

    // Criar device no Traccar
    try {
      const traccarDevice = await this.traccarService.createDevice(dto.imei, dto.imei);
      await this.deviceModel.update({
        where: { id: device.id },
        data: { traccarDeviceId: traccarDevice.id },
      });
      this.logger.log(`Device Traccar criado: ${traccarDevice.id} para IMEI ${dto.imei}`);
    } catch (error) {
      this.logger.warn(`Falha ao criar device no Traccar: ${error instanceof Error ? error.message : error}`);
    }

    return this.findOne(device.id, tenantId);
  }

  async update(id: string, dto: UpdateDeviceDto, tenantId: string) {
    await this.findOne(id, tenantId);

    const updateData: any = {};
    if (dto.brand !== undefined) updateData.brand = dto.brand;
    if (dto.firmwareVersion !== undefined) updateData.firmwareVersion = dto.firmwareVersion;
    if (dto.serialNumber !== undefined) updateData.serialNumber = dto.serialNumber;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.installedBy !== undefined) updateData.installedBy = dto.installedBy;

    await this.deviceModel.update({ where: { id }, data: updateData });
    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.deviceModel.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async linkVehicle(deviceId: string, vehicleId: string, tenantId: string) {
    const device = await this.findOne(deviceId, tenantId);

    // Verificar se veículo pertence ao tenant
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId, deletedAt: null },
    });
    if (!vehicle) throw new NotFoundException('Veículo não encontrado');

    // Verificar se veículo já tem device
    const existingDevice = await this.deviceModel.findFirst({
      where: { vehicleId, deletedAt: null, id: { not: deviceId } },
    });
    if (existingDevice) throw new ConflictException('Veículo já possui um dispositivo vinculado');

    await this.deviceModel.update({
      where: { id: deviceId },
      data: {
        vehicleId,
        status: device.status === 'PENDING_INSTALL' ? 'INSTALLED' : device.status,
        installedAt: device.installedAt || new Date(),
      },
    });

    // Atualizar traccarDeviceId no veículo
    if (device.traccarDeviceId) {
      await this.prisma.vehicle.update({
        where: { id: vehicleId },
        data: { traccarDeviceId: device.traccarDeviceId },
      });
    }

    return this.findOne(deviceId, tenantId);
  }

  async unlinkVehicle(deviceId: string, tenantId: string) {
    const device = await this.findOne(deviceId, tenantId);

    if (device.vehicleId && device.traccarDeviceId) {
      await this.prisma.vehicle.update({
        where: { id: device.vehicleId },
        data: { traccarDeviceId: null },
      });
    }

    await this.deviceModel.update({
      where: { id: deviceId },
      data: { vehicleId: null },
    });

    return this.findOne(deviceId, tenantId);
  }

  async linkChip(deviceId: string, chipId: string, tenantId: string) {
    await this.findOne(deviceId, tenantId);

    // Verificar se chip pertence ao tenant e não está vinculado
    const chip = await (this.prisma as any).chip.findFirst({
      where: { id: chipId, tenantId, deletedAt: null },
    });
    if (!chip) throw new NotFoundException('Chip não encontrado');

    const existingDevice = await this.deviceModel.findFirst({
      where: { chipId, deletedAt: null, id: { not: deviceId } },
    });
    if (existingDevice) throw new ConflictException('Chip já vinculado a outro dispositivo');

    await this.deviceModel.update({
      where: { id: deviceId },
      data: { chipId },
    });

    return this.findOne(deviceId, tenantId);
  }

  async unlinkChip(deviceId: string, tenantId: string) {
    await this.findOne(deviceId, tenantId);

    await this.deviceModel.update({
      where: { id: deviceId },
      data: { chipId: null },
    });

    return this.findOne(deviceId, tenantId);
  }

  async getConnectionStatus(id: string, tenantId: string) {
    const device = await this.findOne(id, tenantId);

    let traccarStatus = null;
    if (device.traccarDeviceId) {
      try {
        traccarStatus = await this.traccarService.getDevice(device.traccarDeviceId);
      } catch (error) {
        this.logger.warn(`Falha ao obter status do Traccar: ${error}`);
      }
    }

    return {
      deviceId: device.id,
      imei: device.imei,
      status: device.status,
      lastConnection: device.lastConnection,
      traccar: traccarStatus
        ? {
            status: traccarStatus.status,
            lastUpdate: traccarStatus.lastUpdate,
            positionId: traccarStatus.positionId,
          }
        : null,
    };
  }
}
