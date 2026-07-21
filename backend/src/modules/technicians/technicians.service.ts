import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { UpdateTechnicianDto } from './dto/update-technician.dto';

const BCRYPT_ROUNDS = 10;
// Alfabeto sem caracteres ambíguos (0/O, 1/I/L) — a senha vai ser ditada por
// WhatsApp e digitada no teclado do celular.
const PASSWORD_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Remove máscara do CPF, deixando só dígitos. */
export function normalizeCpf(cpf: string): string {
  return (cpf || '').replace(/\D/g, '');
}

/** Senha provisória de 8 caracteres. */
export function generateTempPassword(): string {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out +=
      PASSWORD_ALPHABET[Math.floor(Math.random() * PASSWORD_ALPHABET.length)];
  }
  return out;
}

@Injectable()
export class TechniciansService {
  private readonly logger = new Logger(TechniciansService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, search?: string) {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (search) {
      const digits = normalizeCpf(search);
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        ...(digits ? [{ cpf: { contains: digits } }] : []),
      ];
    }

    const technicians = await this.prisma.technician.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        cpf: true,
        phone: true,
        email: true,
        canReceiveEquipment: true,
        active: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        _count: {
          select: {
            stockItems: { where: { associatedAt: null, deletedAt: null } },
            devices: true,
          },
        },
      },
    });

    return technicians.map(({ _count, ...t }) => ({
      ...t,
      assignedCount: _count.stockItems,
      installCount: _count.devices,
    }));
  }

  async create(tenantId: string, dto: CreateTechnicianDto) {
    const cpf = normalizeCpf(dto.cpf);
    const existing = await this.prisma.technician.findFirst({
      where: { tenantId, cpf, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(`Já existe um técnico com o CPF ${cpf}.`);
    }

    const tempPassword = generateTempPassword();
    const technician = await this.prisma.technician.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        cpf,
        phone: dto.phone?.replace(/\D/g, '') || null,
        email: dto.email?.trim() || null,
        canReceiveEquipment: dto.canReceiveEquipment ?? true,
        password: await bcrypt.hash(tempPassword, BCRYPT_ROUNDS),
        mustChangePassword: true,
      },
      select: { id: true, name: true, cpf: true, phone: true, email: true },
    });

    this.logger.log(
      `Técnico criado: ${technician.name} (${cpf}) tenant=${tenantId}`,
    );
    // tempPassword volta só nesta resposta — nunca persistida em claro nem logada.
    return { technician, tempPassword };
  }

  async update(id: string, tenantId: string, dto: UpdateTechnicianDto) {
    await this.findOneOrFail(id, tenantId);
    return this.prisma.technician.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.phone !== undefined && {
          phone: dto.phone?.replace(/\D/g, '') || null,
        }),
        ...(dto.email !== undefined && { email: dto.email?.trim() || null }),
        ...(dto.canReceiveEquipment !== undefined && {
          canReceiveEquipment: dto.canReceiveEquipment,
        }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
      select: {
        id: true,
        name: true,
        cpf: true,
        phone: true,
        email: true,
        canReceiveEquipment: true,
        active: true,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOneOrFail(id, tenantId);
    const emCampo = await this.prisma.stockItem.count({
      where: {
        tenantId,
        assignedTechnicianId: id,
        associatedAt: null,
        deletedAt: null,
      },
    });
    if (emCampo > 0) {
      throw new ConflictException(
        `Técnico tem ${emCampo} equipamento(s) reservado(s). Cancele as reservas antes de excluir.`,
      );
    }
    await this.prisma.technician.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
    return { id };
  }

  async resetPassword(id: string, tenantId: string) {
    const technician = await this.findOneOrFail(id, tenantId);
    const tempPassword = generateTempPassword();
    await this.prisma.technician.update({
      where: { id },
      data: {
        password: await bcrypt.hash(tempPassword, BCRYPT_ROUNDS),
        mustChangePassword: true,
      },
    });
    this.logger.log(
      `Senha resetada pro técnico ${technician.name} tenant=${tenantId}`,
    );
    return { technician, tempPassword };
  }

  async assignments(id: string, tenantId: string) {
    await this.findOneOrFail(id, tenantId);
    return this.prisma.stockItem.findMany({
      where: {
        tenantId,
        assignedTechnicianId: id,
        associatedAt: null,
        deletedAt: null,
      },
      orderBy: { assignedAt: 'desc' },
      select: {
        id: true,
        imei: true,
        iccid: true,
        line: true,
        operator: true,
        server: true,
        assignedAt: true,
      },
    });
  }

  private async findOneOrFail(id: string, tenantId: string) {
    const technician = await this.prisma.technician.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true, cpf: true, phone: true },
    });
    if (!technician) throw new NotFoundException('Técnico não encontrado');
    return technician;
  }
}
