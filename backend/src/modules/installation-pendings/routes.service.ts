import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { agrupar, ordenarRota, type GeoPoint } from './route-geo';

export interface ClusterFilters {
  /** Janela sobre a data de contrato (padrão 60). */
  days: number;
  type?: 'TRACKER' | 'TAG';
  /** Só pendências com valor protegido >= este. */
  minValue?: number;
  /** Só pendências paradas há pelo menos N dias. */
  minDaysPending?: number;
  city?: string;
}

export interface ClusterDto {
  id: string;
  count: number;
  tracker: number;
  tag: number;
  radiusKm: number;
  center: { lat: number; lng: number };
  neighborhood: string | null;
  city: string | null;
  /** Soma do valor protegido do bolsão — quanto de patrimônio a rota cobre. */
  totalValue: number;
  /**
   * IDs das pendências no bolsão, ordenados por valor protegido (maior primeiro).
   * Limitar a rota a N paradas pega as N mais valiosas; a ordem de visita é
   * reotimizada geograficamente no createRoute.
   */
  pendingIds: string[];
}

/**
 * Agrupamento de pendências em bolsões e montagem/entrega de rotas.
 * A geometria pura vive em route-geo.ts; aqui é só a orquestração com o banco.
 */
@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  /** Raio que funde pendências num mesmo bolsão. */
  private static readonly LIMITE_CLUSTER_KM = 2.5;

  constructor(private prisma: PrismaService) {}

  /** Bolsões de pendências geolocalizadas dentro da janela de dias. */
  async clusters(
    tenantId: string,
    filters: ClusterFilters,
  ): Promise<ClusterDto[]> {
    // Janela: contract_date entre (hoje - days) e (hoje - minDaysPending).
    // minDaysPending recorta os mais antigos (parados há X dias ou mais).
    const inicio = new Date();
    inicio.setUTCHours(0, 0, 0, 0);
    inicio.setUTCDate(inicio.getUTCDate() - filters.days);

    const contractDate: { gte: Date; lte?: Date } = { gte: inicio };
    if (filters.minDaysPending && filters.minDaysPending > 0) {
      const fim = new Date();
      fim.setUTCHours(0, 0, 0, 0);
      fim.setUTCDate(fim.getUTCDate() - filters.minDaysPending);
      contractDate.lte = fim;
    }

    const rows = await this.prisma.installationPending.findMany({
      where: {
        tenantId,
        contractDate,
        lat: { not: null },
        lng: { not: null },
        ...(filters.type ? { pendingType: filters.type } : {}),
        ...(filters.city ? { city: filters.city } : {}),
        ...(filters.minValue && filters.minValue > 0
          ? { protectedValue: { gte: filters.minValue } }
          : {}),
      },
      select: {
        id: true,
        lat: true,
        lng: true,
        pendingType: true,
        neighborhood: true,
        city: true,
        protectedValue: true,
      },
    });

    const pontos: Array<GeoPoint & { row: (typeof rows)[number] }> = rows.map(
      (r) => ({ id: r.id, lat: r.lat!, lng: r.lng!, row: r }),
    );

    const clusters = agrupar(pontos, RoutesService.LIMITE_CLUSTER_KM);

    return clusters.map((c, i) => {
      // Prioridade por valor: limitar a rota a N pega os N mais valiosos.
      const porValor = [...c.pontos].sort(
        (a, b) => Number(b.row.protectedValue) - Number(a.row.protectedValue),
      );
      const bairros = new Map<string, number>();
      for (const p of c.pontos) {
        const b = p.row.neighborhood ?? '';
        if (b) bairros.set(b, (bairros.get(b) ?? 0) + 1);
      }
      const bairroTop =
        [...bairros.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      return {
        id: `cluster-${i}`,
        count: c.pontos.length,
        tracker: c.pontos.filter((p) => p.row.pendingType === 'TRACKER').length,
        tag: c.pontos.filter((p) => p.row.pendingType === 'TAG').length,
        radiusKm: Math.round(c.raioKm * 10) / 10,
        center: c.centro,
        neighborhood: bairroTop,
        city: c.pontos[0]?.row.city ?? null,
        totalValue: c.pontos.reduce(
          (s, p) => s + Number(p.row.protectedValue),
          0,
        ),
        pendingIds: porValor.map((p) => p.id),
      };
    });
  }

  /**
   * Monta uma rota a partir das pendências escolhidas, ordena pelo caminho mais
   * curto e envia pro técnico (snapshot dos dados no momento do envio).
   */
  async createRoute(
    tenantId: string,
    technicianId: string,
    pendingIds: string[],
    assignedById?: string,
  ) {
    if (!pendingIds.length) {
      throw new UnprocessableEntityException('Selecione ao menos uma pendência.');
    }

    const tecnico = await this.prisma.technician.findFirst({
      where: { id: technicianId, tenantId, deletedAt: null, active: true },
    });
    if (!tecnico) {
      throw new NotFoundException('Técnico não encontrado ou inativo.');
    }

    const pendencias = await this.prisma.installationPending.findMany({
      where: { id: { in: pendingIds }, tenantId },
    });
    if (!pendencias.length) {
      throw new UnprocessableEntityException(
        'Nenhuma das pendências existe mais (podem ter sido instaladas).',
      );
    }

    // Ordena só as que têm coordenada; as sem-coord vão pro fim, na ordem dada.
    const comCoord = pendencias.filter((p) => p.lat != null && p.lng != null);
    const semCoord = pendencias.filter((p) => p.lat == null || p.lng == null);
    const ordenadas = [
      ...ordenarRota(
        comCoord.map((p) => ({ id: p.id, lat: p.lat!, lng: p.lng! })),
      ).map((o) => comCoord.find((p) => p.id === o.id)!),
      ...semCoord,
    ];

    const route = await this.prisma.installationRoute.create({
      data: {
        tenantId,
        technicianId,
        assignedById: assignedById ?? null,
        status: 'PENDING',
        stops: {
          create: ordenadas.map((p, ordem) => ({
            order: ordem,
            hinovaVehicleCode: p.hinovaVehicleCode,
            plate: p.plate,
            pendingType: p.pendingType,
            associateName: p.associateName,
            phone: p.phone,
            brandModel: p.brandModel,
            street: p.street,
            number: p.number,
            neighborhood: p.neighborhood,
            city: p.city,
            cep: p.cep,
            lat: p.lat,
            lng: p.lng,
          })),
        },
      },
      include: { stops: { orderBy: { order: 'asc' } } },
    });

    this.logger.log(
      `Rota ${route.id} criada com ${ordenadas.length} paradas para o técnico ${technicianId}.`,
    );
    return route;
  }

  /** Rotas de um tenant (para o painel). */
  listRoutes(tenantId: string) {
    return this.prisma.installationRoute.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        technician: { select: { id: true, name: true } },
        stops: { orderBy: { order: 'asc' } },
      },
      take: 100,
    });
  }

  cancelRoute(tenantId: string, routeId: string) {
    return this.prisma.installationRoute.updateMany({
      where: { id: routeId, tenantId },
      data: { status: 'CANCELLED' },
    });
  }

  /** Rota ativa (PENDING) de um técnico — usada pelo app de campo. */
  async currentRouteForTechnician(tenantId: string, technicianId: string) {
    return this.prisma.installationRoute.findFirst({
      where: { tenantId, technicianId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { stops: { orderBy: { order: 'asc' } } },
    });
  }

  /**
   * Marca a parada de uma placa como concluída (chamado quando a instalação é
   * finalizada). Best-effort: se a placa não estiver em nenhuma rota, no-op.
   */
  async markStopDoneByPlate(tenantId: string, plate: string): Promise<void> {
    const normalizada = (plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!normalizada) return;

    const stops = await this.prisma.routeStop.findMany({
      where: {
        plate: normalizada,
        status: 'PENDING',
        route: { tenantId, status: 'PENDING' },
      },
      select: { id: true, routeId: true },
    });
    if (!stops.length) return;

    await this.prisma.routeStop.updateMany({
      where: { id: { in: stops.map((s) => s.id) } },
      data: { status: 'DONE', doneAt: new Date() },
    });

    // Fecha a rota cujas paradas terminaram todas.
    for (const routeId of new Set(stops.map((s) => s.routeId))) {
      const restantes = await this.prisma.routeStop.count({
        where: { routeId, status: 'PENDING' },
      });
      if (restantes === 0) {
        await this.prisma.installationRoute.update({
          where: { id: routeId },
          data: { status: 'DONE' },
        });
      }
    }
  }
}
