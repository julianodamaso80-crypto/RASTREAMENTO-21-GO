import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import { DeviceRegistryService } from '../traccar/device-registry.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { FilterDevicesDto } from './dto/filter-devices.dto';

const BLE_MODELS = ['BLE_KTAG', 'BLE_REDTAG', 'BLE_AIRTAG_GENERIC'];

// Chave privada da TAG BLE: nunca pode voltar em listagem/detalhe/exclusão de
// dispositivo. Só sai do banco pela rota de plano de polling (ble-tags).
const OMIT_BLE_KEY = {
  bleAdvKeyPrivate: true,
  bleAdvKeyHashed: true,
} as const;

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  private get deviceModel() {
    return (this.prisma as any).device;
  }

  constructor(
    private prisma: PrismaService,
    private traccarService: TraccarService,
    private deviceRegistry: DeviceRegistryService,
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
        omit: OMIT_BLE_KEY,
        include: {
          chip: {
            select: {
              id: true,
              iccid: true,
              phoneNumber: true,
              operator: true,
              status: true,
              apn: true,
            },
          },
          vehicle: {
            select: { id: true, plate: true, brand: true, model: true },
          },
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
      omit: OMIT_BLE_KEY,
      include: {
        chip: true,
        vehicle: {
          include: {
            associate: {
              select: { id: true, name: true, cpf: true, phone: true },
            },
          },
        },
        smsCommands: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');
    return device;
  }

  async create(dto: CreateDeviceDto, tenantId: string) {
    const existing = await this.deviceModel.findFirst({
      where: { imei: dto.imei },
    });
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

    // Veículo e chip informados no cadastro precisam ser DESTA empresa e estar
    // livres — o linkVehicle/linkChip sempre validou isso, mas o create não, e
    // um id de outro tenant passava direto. Ver P1.2 do plano.
    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!vehicle) throw new NotFoundException('Veículo não encontrado');

      const ocupado = await this.deviceModel.findFirst({
        where: { vehicleId: dto.vehicleId, deletedAt: null },
        select: { id: true },
      });
      if (ocupado) {
        throw new ConflictException('Veículo já possui um dispositivo vinculado');
      }
      data.vehicleId = dto.vehicleId;
    }

    if (dto.chipId) {
      const chip = await (this.prisma as any).chip.findFirst({
        where: { id: dto.chipId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!chip) throw new NotFoundException('Chip não encontrado');

      const chipEmUso = await this.deviceModel.findFirst({
        where: { chipId: dto.chipId, deletedAt: null },
        select: { id: true },
      });
      if (chipEmUso) {
        throw new ConflictException('Chip já vinculado a outro dispositivo');
      }
      data.chipId = dto.chipId;
    }

    const device = await this.deviceModel.create({ data });

    // TAGs BLE não passam pelo Traccar (não são GPS)
    if (!BLE_MODELS.includes(dto.model)) {
      try {
        // Reutiliza device existente no Traccar (caso o IMEI já tenha sido
        // cadastrado pelo fornecedor) em vez de criar duplicado e ficar órfão.
        const existing = await this.traccarService.getDeviceByUniqueId(
          dto.imei,
        );
        const traccarDevice = existing
          ? existing
          : await this.traccarService.createDevice(dto.imei, dto.imei);

        await this.deviceModel.update({
          where: { id: device.id },
          data: { traccarDeviceId: traccarDevice.id },
        });

        // Device criado já vinculado a um veículo precisa propagar o id do
        // Traccar pro Vehicle, senão o carro não aparece no mapa (só o
        // linkVehicle fazia isso).
        if (dto.vehicleId) {
          await this.prisma.vehicle.update({
            where: { id: dto.vehicleId },
            data: { traccarDeviceId: traccarDevice.id },
          });
          this.deviceRegistry.notifyDeviceChanged(
            `cadastro de rastreador ${dto.imei}`,
          );
        }

        this.logger.log(
          `Device Traccar ${existing ? 'reutilizado' : 'criado'}: ${traccarDevice.id} para IMEI ${dto.imei}`,
        );
      } catch (error) {
        this.logger.error(
          `Falha ao resolver device Traccar para IMEI ${dto.imei}: ${error instanceof Error ? error.message : error}`,
        );
        throw new ConflictException(
          'Não foi possível registrar o rastreador no Traccar. Tente novamente em alguns segundos.',
        );
      }
    }

    return this.findOne(device.id, tenantId);
  }

  async update(id: string, dto: UpdateDeviceDto, tenantId: string) {
    await this.findOne(id, tenantId);

    const updateData: any = {};
    if (dto.brand !== undefined) updateData.brand = dto.brand;
    if (dto.firmwareVersion !== undefined)
      updateData.firmwareVersion = dto.firmwareVersion;
    if (dto.serialNumber !== undefined)
      updateData.serialNumber = dto.serialNumber;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.installedBy !== undefined) updateData.installedBy = dto.installedBy;

    await this.deviceModel.update({ where: { id }, data: updateData });
    return this.findOne(id, tenantId);
  }

  /**
   * Exclusão (soft delete). Se o rastreador estiver instalado, a retirada roda
   * antes — senão o veículo ficaria com `traccarDeviceId` de um device excluído
   * e o aparelho jamais voltaria ao estoque.
   */
  async remove(id: string, tenantId: string) {
    const device = await this.findOne(id, tenantId);
    if (device.vehicleId) {
      await this.uninstall(id, tenantId, { reason: 'Rastreador excluído' });
    }
    return this.deviceModel.update({
      where: { id },
      data: { deletedAt: new Date() },
      omit: OMIT_BLE_KEY,
    });
  }

  /**
   * Retirada do rastreador do veículo (cancelamento, troca de equipamento,
   * sinistro). Devolve o aparelho ao estoque disponível pra ser reinstalado.
   *
   * Antes disto só existia o `remove()`, que marcava `deletedAt` no Device e
   * deixava rastro: o veículo continuava com `traccarDeviceId` (aparecendo no
   * mapa como se estivesse rastreado) e o StockItem seguia com `associatedAt`
   * preenchido — o aparelho sumia do estoque pra sempre. Ver P1.7 do plano.
   */
  async uninstall(
    deviceId: string,
    tenantId: string,
    options: { reason?: string; by?: string } = {},
  ) {
    const device = await this.findOne(deviceId, tenantId);
    const vehicleId: string | null = device.vehicleId ?? null;
    const agora = new Date();

    await this.prisma.$transaction(async (tx) => {
      await (tx as any).device.update({
        where: { id: deviceId },
        data: {
          vehicleId: null,
          chipId: null,
          status: 'DEACTIVATED',
          uninstalledAt: agora,
          uninstalledBy: options.by ?? null,
          uninstallReason: options.reason ?? null,
        },
      });

      // Veículo sai do rastreamento — sem isso continuaria plotado no mapa com
      // a última posição congelada, o que é pior que não aparecer.
      if (vehicleId) {
        await tx.vehicle.update({
          where: { id: vehicleId },
          data: { traccarDeviceId: null },
        });
      }

      // Aparelho volta pro estoque disponível (a listagem filtra associatedAt).
      await tx.stockItem.updateMany({
        where: { tenantId, imei: device.imei },
        data: { associatedAt: null, deviceId: null },
      });
    });

    // Traccar: mantém o device (histórico de posições) mas desabilitado, pra
    // não contar como ativo nem gerar alerta de offline eterno.
    if (device.traccarDeviceId) {
      try {
        await this.traccarService.updateDevice(device.traccarDeviceId, {
          disabled: true,
        });
      } catch (error) {
        this.logger.warn(
          `Retirada ${device.imei}: não consegui desabilitar no Traccar (${
            error instanceof Error ? error.message : error
          }).`,
        );
      }
    }

    this.deviceRegistry.notifyDeviceChanged(`retirada do rastreador ${device.imei}`);
    this.logger.log(
      `Rastreador ${device.imei} retirado${vehicleId ? ` do veículo ${vehicleId}` : ''} e devolvido ao estoque.`,
    );

    return this.findOne(deviceId, tenantId);
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
    if (existingDevice)
      throw new ConflictException('Veículo já possui um dispositivo vinculado');

    await this.deviceModel.update({
      where: { id: deviceId },
      data: {
        vehicleId,
        status:
          device.status === 'PENDING_INSTALL' ? 'INSTALLED' : device.status,
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

    // Mapping do tempo real na hora — sem isso o carro ficava até 2min sem
    // aparecer no mapa depois do vínculo.
    this.deviceRegistry.notifyDeviceChanged(`vínculo do rastreador ${device.imei}`);

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

    this.deviceRegistry.notifyDeviceChanged(
      `desvínculo do rastreador ${device.imei}`,
    );

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
    if (existingDevice)
      throw new ConflictException('Chip já vinculado a outro dispositivo');

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
        traccarStatus = await this.traccarService.getDevice(
          device.traccarDeviceId,
        );
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
