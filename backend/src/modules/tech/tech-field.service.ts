import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { TraccarService } from '../traccar/traccar.service';
import { HINOVA_CLIENT, type IHinovaClient } from '../hinova/hinova.interface';
import { FinishInstallDto } from './dto/finish-install.dto';

@Injectable()
export class TechFieldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly traccar: TraccarService,
    @Inject(HINOVA_CLIENT) private readonly hinova: IHinovaClient,
  ) {}

  /** Equipamentos reservados pro técnico logado. Nunca vaza item de outro. */
  async assignments(technicianId: string, tenantId: string) {
    return this.prisma.stockItem.findMany({
      where: {
        tenantId,
        assignedTechnicianId: technicianId,
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
        status: true,
        assignedAt: true,
      },
    });
  }

  /** Consulta a placa no SGA antes de finalizar. */
  async lookup(placa: string) {
    return this.hinova.lookupByPlate(placa);
  }

  /** O rastreador já reportou posição? Confere no Traccar pelo IMEI. */
  async signal(stockItemId: string, technicianId: string, tenantId: string) {
    const item = await this.findAssignedOrFail(
      stockItemId,
      technicianId,
      tenantId,
    );
    try {
      const device = await this.traccar.getDeviceByUniqueId(item.imei);
      if (!device) {
        return {
          online: false,
          lastUpdate: null,
          motivo: 'ainda não apareceu no servidor GPS',
        };
      }
      return {
        online: device.status === 'online',
        lastUpdate: device.lastUpdate ?? null,
        motivo: null,
      };
    } catch {
      return {
        online: false,
        lastUpdate: null,
        motivo: 'servidor GPS indisponível',
      };
    }
  }

  /** Finaliza a instalação reusando exatamente o motor do painel. */
  async finish(
    stockItemId: string,
    technicianId: string,
    technicianName: string,
    tenantId: string,
    dto: FinishInstallDto,
  ) {
    await this.findAssignedOrFail(stockItemId, technicianId, tenantId);
    return this.stock.associate(stockItemId, tenantId, {
      placa: dto.placa,
      technicianName,
      technicianId,
      installLocation: dto.installLocation,
    });
  }

  /**
   * 404 (não 403) quando o item existe mas é de outro técnico — não confirma a
   * existência do IMEI pra quem não tem direito a ele.
   */
  private async findAssignedOrFail(
    id: string,
    technicianId: string,
    tenantId: string,
  ) {
    const item = await this.prisma.stockItem.findFirst({
      where: {
        id,
        tenantId,
        assignedTechnicianId: technicianId,
        associatedAt: null,
        deletedAt: null,
      },
      select: { id: true, imei: true },
    });
    if (!item) throw new NotFoundException('Equipamento não está na sua lista');
    return item;
  }
}
