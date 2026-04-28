import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import {
  CreateGeofenceDto,
  UpdateGeofenceDto,
} from './dto/create-geofence.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

@Injectable()
export class GeofencesService {
  private readonly logger = new Logger(GeofencesService.name);

  constructor(
    private prisma: PrismaService,
    private traccarService: TraccarService,
  ) {}

  async findAll(tenantId: string, query: PaginationQueryDto) {
    const { page, perPage } = query;
    const where = { tenantId };

    const [data, total] = await Promise.all([
      this.prisma.geofence.findMany({
        where,
        include: {
          geofenceVehicles: {
            include: {
              vehicle: {
                select: { id: true, plate: true, brand: true, model: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.geofence.count({ where }),
    ]);

    return { data, meta: { total, page, perPage } };
  }

  async findOne(id: string, tenantId: string) {
    const geofence = await this.prisma.geofence.findFirst({
      where: { id, tenantId },
      include: {
        geofenceVehicles: {
          include: {
            vehicle: {
              select: { id: true, plate: true, brand: true, model: true },
            },
          },
        },
      },
    });
    if (!geofence) throw new NotFoundException('Cerca não encontrada');
    return geofence;
  }

  async create(dto: CreateGeofenceDto, tenantId: string) {
    const geofence = await this.prisma.geofence.create({
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        coordinates: dto.coordinates as any,
        color: dto.color || '#3b82f6',
        tenantId,
      },
    });

    // Sync com Traccar
    try {
      const area = this.coordinatesToTraccarArea(dto.type, dto.coordinates);
      const traccarGeofence = await this.traccarService.createGeofence(
        dto.name,
        area,
      );
      await this.prisma.geofence.update({
        where: { id: geofence.id },
        data: { traccarGeofenceId: traccarGeofence.id },
      });
    } catch (error) {
      this.logger.warn(`Falha ao sync geofence com Traccar: ${error}`);
    }

    return geofence;
  }

  async update(id: string, dto: UpdateGeofenceDto, tenantId: string) {
    const existing = await this.findOne(id, tenantId);

    const updated = await this.prisma.geofence.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        coordinates: dto.coordinates as any,
        color: dto.color,
      },
    });

    if (existing.traccarGeofenceId && dto.coordinates) {
      try {
        const area = this.coordinatesToTraccarArea(
          existing.type,
          dto.coordinates,
        );
        await this.traccarService.updateGeofence(
          existing.traccarGeofenceId,
          dto.name || existing.name,
          area,
        );
      } catch (error) {
        this.logger.warn(`Falha ao atualizar geofence no Traccar: ${error}`);
      }
    }

    return updated;
  }

  async remove(id: string, tenantId: string) {
    const geofence = await this.findOne(id, tenantId);

    if (geofence.traccarGeofenceId) {
      try {
        await this.traccarService.deleteGeofence(geofence.traccarGeofenceId);
      } catch (error) {
        this.logger.warn(`Falha ao remover geofence do Traccar: ${error}`);
      }
    }

    await this.prisma.geofenceVehicle.deleteMany({ where: { geofenceId: id } });
    await this.prisma.geofence.delete({ where: { id } });
    return { deleted: true };
  }

  async linkVehicles(
    geofenceId: string,
    vehicleIds: string[],
    tenantId: string,
  ) {
    await this.findOne(geofenceId, tenantId);

    // Remove existing links
    await this.prisma.geofenceVehicle.deleteMany({ where: { geofenceId } });

    // Create new links
    const data = vehicleIds.map((vehicleId) => ({
      geofenceId,
      vehicleId,
    }));

    await this.prisma.geofenceVehicle.createMany({
      data,
      skipDuplicates: true,
    });

    return this.findOne(geofenceId, tenantId);
  }

  // Buscar geofences de um veículo para checagem de alertas
  async getVehicleGeofences(vehicleId: string, tenantId: string) {
    const links = await this.prisma.geofenceVehicle.findMany({
      where: { vehicleId },
      include: { geofence: true },
    });
    return links
      .map((l) => l.geofence)
      .filter((g) => g.tenantId === tenantId && g.active);
  }

  // Point-in-geofence check
  isPointInGeofence(
    lat: number,
    lng: number,
    geofence: { type: string; coordinates: any },
  ): boolean {
    if (geofence.type === 'CIRCLE') {
      const { latitude, longitude, radius } = geofence.coordinates;
      const distance = this.haversineDistance(lat, lng, latitude, longitude);
      return distance <= radius; // radius em metros
    }

    if (geofence.type === 'POLYGON') {
      const polygon = geofence.coordinates as number[][]; // [[lng, lat], ...]
      return this.pointInPolygon(lat, lng, polygon);
    }

    return false;
  }

  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000; // metros
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private pointInPolygon(
    lat: number,
    lng: number,
    polygon: number[][],
  ): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][1]; // lat
      const yi = polygon[i][0]; // lng
      const xj = polygon[j][1];
      const yj = polygon[j][0];
      const intersect =
        yi > lng !== yj > lng &&
        lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private coordinatesToTraccarArea(
    type: string,
    coordinates: Record<string, unknown>,
  ): string {
    if (type === 'CIRCLE') {
      const { latitude, longitude, radius } = coordinates as any;
      return `CIRCLE (${latitude} ${longitude}, ${radius})`;
    }
    // POLYGON
    const points = coordinates as unknown as number[][];
    const wkt = points.map((p) => `${p[1]} ${p[0]}`).join(', ');
    return `POLYGON ((${wkt}, ${points[0][1]} ${points[0][0]}))`;
  }
}
