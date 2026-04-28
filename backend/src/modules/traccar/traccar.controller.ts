import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { TraccarService } from './traccar.service';
import { PrismaService } from '../prisma/prisma.service';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; tenantId: string; role: string };
}

@ApiTags('Traccar')
@ApiBearerAuth()
@Controller('traccar')
export class TraccarController {
  constructor(
    private traccarService: TraccarService,
    private prisma: PrismaService,
  ) {}

  @Get('devices')
  @ApiOperation({
    summary: 'Lista dispositivos do Traccar (filtrado por tenant)',
  })
  async getDevices(@Req() req: AuthenticatedRequest) {
    const tenantId = req.tenantId;
    const vehicles = await this.prisma.vehicle.findMany({
      where: { tenantId, traccarDeviceId: { not: null }, deletedAt: null },
      select: { traccarDeviceId: true },
    });

    const deviceIds = vehicles
      .map((v) => v.traccarDeviceId)
      .filter((id): id is number => id !== null);

    if (deviceIds.length === 0) return [];

    const allDevices = await this.traccarService.getDevices();
    return allDevices.filter((d) => deviceIds.includes(d.id));
  }

  @Get('positions')
  @ApiOperation({
    summary: 'Posições atuais de todos os dispositivos do tenant',
  })
  async getPositions(@Req() req: AuthenticatedRequest) {
    const tenantId = req.tenantId;
    const vehicles = await this.prisma.vehicle.findMany({
      where: { tenantId, traccarDeviceId: { not: null }, deletedAt: null },
      select: { traccarDeviceId: true, plate: true, id: true },
    });

    const deviceIds = vehicles
      .map((v) => v.traccarDeviceId)
      .filter((id): id is number => id !== null);

    if (deviceIds.length === 0) return [];

    const positions = await this.traccarService.getPositions();
    return positions.filter((p) => deviceIds.includes(p.deviceId));
  }

  @Get('positions/:deviceId/history')
  @ApiOperation({ summary: 'Histórico de posições de um dispositivo' })
  @ApiQuery({
    name: 'from',
    required: true,
    description: 'Data início (ISO 8601)',
  })
  @ApiQuery({ name: 'to', required: true, description: 'Data fim (ISO 8601)' })
  async getPositionHistory(
    @Param('deviceId') deviceId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const tenantId = req.tenantId;

    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        tenantId,
        traccarDeviceId: parseInt(deviceId),
        deletedAt: null,
      },
    });

    if (!vehicle) {
      return [];
    }

    return this.traccarService.getPositions(parseInt(deviceId), from, to);
  }
}
