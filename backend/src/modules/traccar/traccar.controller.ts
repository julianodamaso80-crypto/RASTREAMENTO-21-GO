import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { TraccarService } from './traccar.service';
import { PrismaService } from '../prisma/prisma.service';
import { FrotaPainelService, etagCasa } from './frota-painel.service';

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
    private frota: FrotaPainelService,
  ) {}

  /** Com o etag igual ao do navegador responde 304 sem corpo (o Express não recalcula o ETag quando ele já está setado). */
  private responderComEtag<T>(
    lista: T[],
    etag: string,
    ifNoneMatch: string | undefined,
    res: Response,
  ): T[] | undefined {
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (etagCasa(ifNoneMatch, etag)) {
      res.status(304);
      return undefined;
    }
    return lista;
  }

  @Get('devices')
  @ApiOperation({
    summary: 'Lista dispositivos do Traccar (filtrado por tenant)',
  })
  async getDevices(
    @Req() req: AuthenticatedRequest,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenantId = req.tenantId;
    if (this.frota.ligado) {
      const f = await this.frota.frotaDoTenant(tenantId);
      // Mesmo objeto de erro de hoje, para o filtro global tratar igual.
      if ('erroDevices' in f) throw f.erroDevices;
      return this.responderComEtag(f.devices, f.etagDevices, ifNoneMatch, res);
    }
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
  async getPositions(
    @Req() req: AuthenticatedRequest,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenantId = req.tenantId;
    if (this.frota.ligado) {
      const f = await this.frota.frotaDoTenant(tenantId);
      if ('erroPositions' in f) throw f.erroPositions;
      return this.responderComEtag(
        f.positions,
        f.etagPositions,
        ifNoneMatch,
        res,
      );
    }
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
