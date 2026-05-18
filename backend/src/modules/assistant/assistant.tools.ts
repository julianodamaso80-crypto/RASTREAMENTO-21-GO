import { Injectable } from '@nestjs/common';
import { AlertType } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesAnalyticsService } from '../vehicles-analytics/vehicles-analytics.service';
import { ScoringService } from '../scoring/scoring.service';
import { MaintenanceService } from '../maintenance/maintenance.service';

/**
 * Definição das tools que o modelo pode chamar. Toda execução PASSA por
 * AssistantTools.execute, que aplica filtro de tenantId sem confiar no modelo —
 * o argumento de tenantId é ignorado se vier no input, e o tenant do user
 * autenticado é injetado server-side.
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'query_vehicles',
    description: 'Lista veículos do tenant com filtros opcionais (placa, status, modelo). Use pra contar quantos veículos estão em cada estado, achar veículo por placa, etc.',
    input_schema: {
      type: 'object',
      properties: {
        plate: { type: 'string', description: 'Filtro por placa (busca parcial)' },
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'BLOCKED', 'DEFAULTING'] },
        limit: { type: 'integer', default: 50 },
      },
    },
  },
  {
    name: 'query_alerts',
    description: 'Lista alertas do tenant num período. Filtros por tipo, status, veículo. Use pra responder perguntas como "quantos SOS hoje?", "alertas de sabotagem semana passada".',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Janela em dias (ex: 1=hoje, 7=semana)', default: 7 },
        type: { type: 'string', description: 'Tipo de alerta (ex: SPEED, POWER_CUT, JAMMING)' },
        status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] },
        plate: { type: 'string' },
        limit: { type: 'integer', default: 50 },
      },
    },
  },
  {
    name: 'vehicle_behavior',
    description: 'Análise comportamental de um veículo específico (ignição, idle, KM, excessos) num período. Use depois de identificar o veículo por placa.',
    input_schema: {
      type: 'object',
      properties: {
        plate: { type: 'string' },
        period: { type: 'string', enum: ['24h', '7d', '30d'], default: '7d' },
      },
      required: ['plate'],
    },
  },
  {
    name: 'vehicle_score',
    description: 'Score de motorista de um veículo (0-100, maior é melhor) + breakdown de velocidade, frenagem, idle, etc.',
    input_schema: {
      type: 'object',
      properties: { plate: { type: 'string' } },
      required: ['plate'],
    },
  },
  {
    name: 'maintenance_overview',
    description: 'Planos de manutenção pendentes ou vencidos. Use pra responder "quais carros precisam de troca de óleo?".',
    input_schema: {
      type: 'object',
      properties: {
        plate: { type: 'string' },
        severityOnly: { type: 'boolean', description: 'Apenas UPCOMING/DUE/OVERDUE', default: true },
      },
    },
  },
  {
    name: 'fleet_summary',
    description: 'Resumo da frota: total de veículos, online/offline, alertas críticos abertos, top KM. Use pra perguntas amplas.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

@Injectable()
export class AssistantTools {
  constructor(
    private prisma: PrismaService,
    private analytics: VehiclesAnalyticsService,
    private scoring: ScoringService,
    private maintenance: MaintenanceService,
  ) {}

  async execute(name: string, input: Record<string, unknown>, tenantId: string): Promise<unknown> {
    switch (name) {
      case 'query_vehicles':
        return this.queryVehicles(input, tenantId);
      case 'query_alerts':
        return this.queryAlerts(input, tenantId);
      case 'vehicle_behavior':
        return this.vehicleBehavior(input, tenantId);
      case 'vehicle_score':
        return this.vehicleScore(input, tenantId);
      case 'maintenance_overview':
        return this.maintenanceOverview(input, tenantId);
      case 'fleet_summary':
        return this.fleetSummary(tenantId);
      default:
        return { error: `Tool desconhecida: ${name}` };
    }
  }

  private async queryVehicles(input: Record<string, unknown>, tenantId: string) {
    const limit = Math.min(Number(input.limit) || 50, 200);
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(input.plate ? { plate: { contains: String(input.plate).toUpperCase() } } : {}),
        ...(input.status ? { status: input.status as 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'DEFAULTING' } : {}),
      },
      select: {
        id: true,
        plate: true,
        brand: true,
        model: true,
        status: true,
        device: { select: { lastConnection: true, status: true } },
      },
      take: limit,
    });
    return { count: vehicles.length, vehicles };
  }

  private async queryAlerts(input: Record<string, unknown>, tenantId: string) {
    const days = Number(input.days) || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const limit = Math.min(Number(input.limit) || 50, 200);

    const where: Record<string, unknown> = { tenantId, createdAt: { gte: since }, deletedAt: null };
    if (input.type) where.type = input.type as AlertType;
    if (input.status) where.status = input.status;
    if (input.plate) {
      where.vehicle = { plate: { contains: String(input.plate).toUpperCase() } };
    }

    const alerts = await this.prisma.alert.findMany({
      where,
      include: { vehicle: { select: { plate: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const byType = (alerts as Array<{ type: string }>).reduce<Record<string, number>>((acc, a) => {
      acc[a.type] = (acc[a.type] ?? 0) + 1;
      return acc;
    }, {});
    return {
      total: alerts.length,
      byType,
      sample: (alerts as Array<{ type: string; severity: string; vehicle: { plate: string }; message: string; status: string; createdAt: Date }>).slice(0, 20).map((a) => ({
        type: a.type,
        severity: a.severity,
        plate: a.vehicle.plate,
        message: a.message,
        status: a.status,
        createdAt: a.createdAt,
      })),
    };
  }

  private async vehicleBehavior(input: Record<string, unknown>, tenantId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { tenantId, plate: String(input.plate).toUpperCase(), deletedAt: null },
      select: { id: true, plate: true },
    });
    if (!vehicle) return { error: 'Veículo não encontrado' };
    const period = (input.period as '24h' | '7d' | '30d') ?? '7d';
    const report = await this.analytics.getBehavior(vehicle.id, tenantId, period);
    return { plate: vehicle.plate, ...report };
  }

  private async vehicleScore(input: Record<string, unknown>, tenantId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { tenantId, plate: String(input.plate).toUpperCase(), deletedAt: null },
      select: { id: true, plate: true },
    });
    if (!vehicle) return { error: 'Veículo não encontrado' };
    const score = await this.scoring.getLatest(vehicle.id, tenantId);
    return { plate: vehicle.plate, ...score };
  }

  private async maintenanceOverview(input: Record<string, unknown>, tenantId: string) {
    const plans = await this.maintenance.list(tenantId);
    type PlanRow = {
      id: string;
      vehicleId: string;
      name: string;
      type: string;
      severity: string | null;
      intervalKm: number | null;
      intervalEngineHours: number | null;
      lastDoneAt: Date | null;
    };
    let filtered = plans as PlanRow[];
    if (input.plate) {
      const v = await this.prisma.vehicle.findFirst({
        where: { tenantId, plate: String(input.plate).toUpperCase(), deletedAt: null },
        select: { id: true },
      });
      filtered = filtered.filter((p: PlanRow) => p.vehicleId === v?.id);
    }
    if (input.severityOnly !== false) {
      filtered = filtered.filter((p: PlanRow) => p.severity !== null);
    }
    return {
      count: filtered.length,
      plans: filtered.map((p: PlanRow) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        severity: p.severity,
        intervalKm: p.intervalKm,
        intervalEngineHours: p.intervalEngineHours,
        lastDoneAt: p.lastDoneAt,
      })),
    };
  }

  private async fleetSummary(tenantId: string) {
    const [total, blocked, criticalOpen] = await Promise.all([
      this.prisma.vehicle.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.vehicle.count({ where: { tenantId, deletedAt: null, status: 'BLOCKED' } }),
      this.prisma.alert.count({
        where: { tenantId, deletedAt: null, severity: 'CRITICAL', status: { not: 'RESOLVED' } },
      }),
    ]);
    return { totalVehicles: total, blockedVehicles: blocked, criticalAlertsOpen: criticalOpen };
  }
}
