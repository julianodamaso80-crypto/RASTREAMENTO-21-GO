import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma, VehicleStatus } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { FilterVehiclesDto } from './dto/filter-vehicles.dto';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    private prisma: PrismaService,
    private traccarService: TraccarService,
  ) {}

  async findAll(tenantId: string, filters: FilterVehiclesDto) {
    const { page, perPage, status, plate, search } = filters;

    const where: Prisma.VehicleWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (status) where.status = status;
    if (plate) where.plate = { contains: plate, mode: 'insensitive' };
    if (search) {
      where.OR = [
        { plate: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: {
          associate: { select: { id: true, name: true, cpf: true, phone: true } },
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, perPage },
    };
  }

  async findOne(id: string, tenantId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        associate: true,
        tenant: { select: { id: true, name: true } },
      },
    });

    if (!vehicle) {
      throw new NotFoundException('Veículo não encontrado');
    }

    return vehicle;
  }

  async create(dto: CreateVehicleDto, tenantId: string) {
    // Verifica placa duplicada no tenant
    const existing = await this.prisma.vehicle.findFirst({
      where: { plate: dto.plate, tenantId, deletedAt: null },
    });

    if (existing) {
      throw new ConflictException('Placa já cadastrada nesta empresa');
    }

    // Cria veículo no banco
    const vehicle = await this.prisma.vehicle.create({
      data: {
        plate: dto.plate,
        uniqueId: dto.uniqueId,
        brand: dto.brand,
        model: dto.model,
        year: dto.year,
        color: dto.color,
        chassi: dto.chassi,
        renavam: dto.renavam,
        tenantId,
        associateId: dto.associateId,
      },
    });

    // Tenta criar dispositivo no Traccar
    try {
      const device = await this.traccarService.createDevice(
        dto.plate,
        dto.uniqueId,
      );
      await this.prisma.vehicle.update({
        where: { id: vehicle.id },
        data: { traccarDeviceId: device.id },
      });
      this.logger.log(`Device Traccar criado: ${device.id} para veículo ${dto.plate}`);
    } catch (error) {
      this.logger.warn(
        `Falha ao criar device no Traccar para ${dto.plate}: ${error instanceof Error ? error.message : error}`,
      );
    }

    return vehicle;
  }

  async update(id: string, dto: UpdateVehicleDto, tenantId: string) {
    const vehicle = await this.findOne(id, tenantId);

    const updated = await this.prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        plate: dto.plate,
        brand: dto.brand,
        model: dto.model,
        year: dto.year,
        color: dto.color,
        chassi: dto.chassi,
        renavam: dto.renavam,
        uniqueId: dto.uniqueId,
        associateId: dto.associateId,
      },
    });

    // Atualiza nome no Traccar se placa mudou
    if (dto.plate && vehicle.traccarDeviceId) {
      try {
        await this.traccarService.updateDevice(vehicle.traccarDeviceId, {
          name: dto.plate,
        } as any);
      } catch (error) {
        this.logger.warn(`Falha ao atualizar device no Traccar: ${error}`);
      }
    }

    return updated;
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);

    return this.prisma.vehicle.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async block(id: string, tenantId: string) {
    const vehicle = await this.findOne(id, tenantId);

    if (vehicle.traccarDeviceId) {
      try {
        await this.traccarService.sendCommand(
          vehicle.traccarDeviceId,
          'engineStop',
        );
        this.logger.log(`Comando de bloqueio enviado para ${vehicle.plate}`);
      } catch (error) {
        this.logger.warn(`Falha ao enviar comando de bloqueio: ${error}`);
      }
    }

    return this.prisma.vehicle.update({
      where: { id },
      data: { status: VehicleStatus.BLOCKED },
    });
  }

  async unblock(id: string, tenantId: string) {
    const vehicle = await this.findOne(id, tenantId);

    if (vehicle.traccarDeviceId) {
      try {
        await this.traccarService.sendCommand(
          vehicle.traccarDeviceId,
          'engineResume',
        );
        this.logger.log(`Comando de desbloqueio enviado para ${vehicle.plate}`);
      } catch (error) {
        this.logger.warn(`Falha ao enviar comando de desbloqueio: ${error}`);
      }
    }

    return this.prisma.vehicle.update({
      where: { id },
      data: { status: VehicleStatus.ACTIVE },
    });
  }
}
