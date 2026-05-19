import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    private configService: ConfigService,
  ) {}

  /**
   * Quando true (env var `BLOCK_COMMANDS_DRY_RUN=true`), block/unblock NÃO
   * envia o comando real ao Traccar — só registra no log e atualiza o banco.
   * Útil pra desenvolver/testar sem risco de bloquear um carro real ligado.
   * Default: false (produção dispara o comando de verdade).
   */
  private isBlockCommandDryRun(): boolean {
    return this.configService.get<string>('BLOCK_COMMANDS_DRY_RUN') === 'true';
  }

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
          associate: {
            select: { id: true, name: true, cpf: true, phone: true },
          },
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

  /**
   * Lista veículos vinculados ao userId via UserVehicleAccess (role CLIENT).
   * Mantém os filtros do findAll mas restringe ao subset que o user possui.
   */
  async findOwnedByUser(
    userId: string,
    tenantId: string,
    filters: FilterVehiclesDto,
  ) {
    const { page, perPage, status, plate, search } = filters;

    const accesses = await this.prisma.userVehicleAccess.findMany({
      where: { userId },
      select: { vehicleId: true },
    });
    const allowedIds = accesses.map((a) => a.vehicleId);

    if (allowedIds.length === 0) {
      return { data: [], meta: { total: 0, page, perPage } };
    }

    const where: Prisma.VehicleWhereInput = {
      tenantId,
      deletedAt: null,
      id: { in: allowedIds },
    };

    if (status) where.status = status;
    if (plate) where.plate = { contains: plate, mode: 'insensitive' };
    if (search) {
      where.AND = [
        {
          OR: [
            { plate: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } },
            { brand: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: {
          associate: {
            select: { id: true, name: true, cpf: true, phone: true },
          },
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return { data, meta: { total, page, perPage } };
  }

  /**
   * Detalhes de um veículo SE pertencer ao userId (role CLIENT).
   * Joga 404 (não 403) pra não vazar informação de existência.
   */
  async findOneOwnedByUser(
    id: string,
    userId: string,
    tenantId: string,
  ) {
    const access = await this.prisma.userVehicleAccess.findUnique({
      where: { userId_vehicleId: { userId, vehicleId: id } },
    });
    if (!access) {
      throw new NotFoundException('Veículo não encontrado');
    }
    return this.findOne(id, tenantId);
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

    // Resolve o device no Traccar ANTES de criar o Vehicle no nosso banco.
    // Se o IMEI já existe no Traccar (cadastrado pelo fornecedor do J16, por
    // exemplo), reaproveita o id em vez de criar duplicado e ficar órfão.
    let traccarDeviceId: number | null = null;
    try {
      const existingTraccar = await this.traccarService.getDeviceByUniqueId(
        dto.uniqueId,
      );
      if (existingTraccar) {
        traccarDeviceId = existingTraccar.id;
        this.logger.log(
          `Device Traccar já existia para uniqueId ${dto.uniqueId}: id=${existingTraccar.id} — reutilizando`,
        );
      } else {
        const created = await this.traccarService.createDevice(
          dto.plate,
          dto.uniqueId,
        );
        traccarDeviceId = created.id;
        this.logger.log(
          `Device Traccar criado: ${created.id} para veículo ${dto.plate}`,
        );
      }
    } catch (error) {
      // Falha de Traccar agora é exceção: melhor abortar o cadastro do que
      // criar Vehicle órfão sem traccarDeviceId (invisível no mapa).
      this.logger.error(
        `Falha ao resolver device Traccar para ${dto.uniqueId}: ${error instanceof Error ? error.message : error}`,
      );
      throw new ConflictException(
        'Não foi possível registrar o rastreador no Traccar. Tente novamente em alguns segundos.',
      );
    }

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
        traccarDeviceId,
      },
    });

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
    return this.sendBlockCommand(id, tenantId, 'block');
  }

  async unblock(id: string, tenantId: string) {
    return this.sendBlockCommand(id, tenantId, 'unblock');
  }

  /**
   * Fluxo seguro de block/unblock:
   * 1. Veículo precisa ter `traccarDeviceId` — sem rastreador vinculado,
   *    não tem o que comandar (BadRequest, não 500).
   * 2. Envia o comando via Traccar (que já tem withRetry x3 internamente).
   * 3. SE o comando falhar → propaga 503 e NÃO atualiza status no banco.
   *    Assim o frontend mostra erro real e o operador sabe que precisa
   *    reagir, em vez de ver "bloqueado" enganosamente.
   * 4. SÓ atualiza o banco depois de o Traccar aceitar o comando.
   *
   * BLOCK_COMMANDS_DRY_RUN=true pula o passo 2 — só pra dev/teste.
   */
  private async sendBlockCommand(
    id: string,
    tenantId: string,
    op: 'block' | 'unblock',
  ) {
    const vehicle = await this.findOne(id, tenantId);

    if (!vehicle.traccarDeviceId) {
      throw new BadRequestException(
        'Veículo sem rastreador vinculado. Cadastre um device no Traccar antes de bloquear.',
      );
    }

    const commandType = op === 'block' ? 'engineStop' : 'engineResume';
    const newStatus =
      op === 'block' ? VehicleStatus.BLOCKED : VehicleStatus.ACTIVE;
    const dryRun = this.isBlockCommandDryRun();

    if (dryRun) {
      this.logger.warn(
        `[DRY RUN] Comando ${commandType} NÃO enviado ao Traccar — flag BLOCK_COMMANDS_DRY_RUN ativa. Placa=${vehicle.plate}`,
      );
    } else {
      try {
        await this.traccarService.sendCommand(
          vehicle.traccarDeviceId,
          commandType,
        );
        this.logger.log(
          `Comando ${commandType} aceito pelo Traccar para ${vehicle.plate} (deviceId=${vehicle.traccarDeviceId})`,
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Falha ao enviar ${commandType} para ${vehicle.plate}: ${msg}`,
        );
        // NÃO atualiza o banco quando o comando falha. Se a UI mostrasse
        // "bloqueado" sem o Traccar ter aceito, o operador ficaria seguro
        // achando que o carro está parado — risco grave.
        throw new ServiceUnavailableException(
          `Não foi possível ${op === 'block' ? 'bloquear' : 'desbloquear'} o veículo: ${msg}`,
        );
      }
    }

    return this.prisma.vehicle.update({
      where: { id },
      data: { status: newStatus },
    });
  }
}
