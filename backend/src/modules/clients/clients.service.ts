import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Clientes Ativos: associados que já têm veículo/rastreador vinculado (fluxo
 * "Associar cliente e ativo" a partir do estoque).
 */
@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async findActive(tenantId: string, search?: string) {
    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      vehicles: { some: { deletedAt: null } },
    };
    if (search) {
      const s = search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { cpf: { contains: s.replace(/\D/g, '') } },
        {
          vehicles: {
            some: { plate: { contains: s.toUpperCase() }, deletedAt: null },
          },
        },
      ];
    }

    const associates = await this.prisma.associate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        vehicles: {
          where: { deletedAt: null },
          include: { device: true },
        },
      },
    });

    return associates.map((a) => ({
      id: a.id,
      name: a.name,
      cpf: a.cpf,
      phone: a.phone,
      email: a.email,
      hinovaCode: a.hinovaCode,
      createdAt: a.createdAt,
      vehicles: a.vehicles.map((v) => ({
        id: v.id,
        plate: v.plate,
        model: v.model,
        chassi: v.chassi,
        status: v.status,
        device: v.device
          ? {
              id: v.device.id,
              imei: v.device.imei,
              status: v.device.status,
              installedBy: v.device.installedBy,
              installLocation: v.device.installLocation,
              installedAt: v.device.installedAt,
            }
          : null,
      })),
    }));
  }
}
