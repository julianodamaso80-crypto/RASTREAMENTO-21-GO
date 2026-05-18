import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AlertType,
  MaintenanceSeverity,
  MaintenanceType,
} from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import { AlertsService } from '../alerts/alerts.service';

export interface CreatePlanDto {
  vehicleId: string;
  type: MaintenanceType;
  name: string;
  intervalKm?: number;
  intervalEngineHours?: number;
  intervalMonths?: number;
  lastDoneAt?: string;
  lastDoneKm?: number;
  lastDoneEngineHours?: number;
}

interface EvaluablePlan {
  id: string;
  vehicleId: string;
  name: string;
  intervalKm: number | null;
  intervalEngineHours: number | null;
  intervalMonths: number | null;
  lastDoneAt: Date | null;
  lastDoneKm: number | null;
  lastDoneEngineHours: number | null;
  severity: MaintenanceSeverity | null;
  vehicle: { id: string; plate: string; traccarDeviceId: number | null; tenantId: string };
}

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private prisma: PrismaService,
    private traccar: TraccarService,
    private alerts: AlertsService,
  ) {}

  async list(tenantId: string, vehicleId?: string) {
    return this.prisma.maintenancePlan.findMany({
      where: { tenantId, deletedAt: null, ...(vehicleId ? { vehicleId } : {}) },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(tenantId: string, dto: CreatePlanDto) {
    return this.prisma.maintenancePlan.create({
      data: {
        tenantId,
        vehicleId: dto.vehicleId,
        type: dto.type,
        name: dto.name,
        intervalKm: dto.intervalKm ?? null,
        intervalEngineHours: dto.intervalEngineHours ?? null,
        intervalMonths: dto.intervalMonths ?? null,
        lastDoneAt: dto.lastDoneAt ? new Date(dto.lastDoneAt) : null,
        lastDoneKm: dto.lastDoneKm ?? null,
        lastDoneEngineHours: dto.lastDoneEngineHours ?? null,
      },
    });
  }

  async update(id: string, tenantId: string, patch: Partial<CreatePlanDto>) {
    const plan = await this.getOrThrow(id, tenantId);
    return this.prisma.maintenancePlan.update({
      where: { id: plan.id },
      data: {
        name: patch.name ?? plan.name,
        intervalKm: patch.intervalKm ?? plan.intervalKm,
        intervalEngineHours: patch.intervalEngineHours ?? plan.intervalEngineHours,
        intervalMonths: patch.intervalMonths ?? plan.intervalMonths,
      },
    });
  }

  async markDone(id: string, tenantId: string) {
    const plan = await this.getOrThrow(id, tenantId);
    const summary = await this.fetchSummary(plan.vehicleId);
    return this.prisma.maintenancePlan.update({
      where: { id: plan.id },
      data: {
        lastDoneAt: new Date(),
        lastDoneKm: summary ? summary.endOdometer / 1000 : plan.lastDoneKm,
        lastDoneEngineHours: summary ? summary.engineHours : plan.lastDoneEngineHours,
        severity: null,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    const plan = await this.getOrThrow(id, tenantId);
    return this.prisma.maintenancePlan.update({
      where: { id: plan.id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Roda diariamente. Para cada plano ativo:
   * - Lê odômetro/horas atuais via Traccar reportSummary (último ano)
   * - Compara com último done + intervalo
   * - Se < 10% restante → UPCOMING; <= 0 → DUE; < -10% → OVERDUE + cria Alert
   */
  async evaluateAll() {
    const plans = await this.prisma.maintenancePlan.findMany({
      where: { active: true, deletedAt: null },
      include: { vehicle: { select: { id: true, plate: true, traccarDeviceId: true, tenantId: true } } },
    });

    for (const plan of plans as Array<EvaluablePlan>) {
      try {
        await this.evaluateOne(plan);
      } catch (err) {
        this.logger.warn(`Plano ${plan.id} (${plan.name}) falhou: ${(err as Error).message}`);
      }
    }
  }

  private async evaluateOne(plan: EvaluablePlan) {
    const vehicle = plan.vehicle;
    if (!vehicle || !vehicle.traccarDeviceId) return;

    const summary = await this.fetchSummary(vehicle.id);
    if (!summary) return;

    const currentKm = summary.endOdometer / 1000;
    const currentHours = summary.engineHours / 3600; // engineHours vem em segundos no Traccar

    const remainingPercents: number[] = [];

    if (plan.intervalKm && plan.lastDoneKm !== null) {
      const used = currentKm - plan.lastDoneKm;
      const remaining = plan.intervalKm - used;
      remainingPercents.push(remaining / plan.intervalKm);
    }
    if (plan.intervalEngineHours && plan.lastDoneEngineHours !== null) {
      const used = currentHours - plan.lastDoneEngineHours;
      const remaining = plan.intervalEngineHours - used;
      remainingPercents.push(remaining / plan.intervalEngineHours);
    }
    if (plan.intervalMonths && plan.lastDoneAt) {
      const monthsPassed = (Date.now() - plan.lastDoneAt.getTime()) / (1000 * 60 * 60 * 24 * 30);
      const remaining = plan.intervalMonths - monthsPassed;
      remainingPercents.push(remaining / plan.intervalMonths);
    }

    if (remainingPercents.length === 0) return;
    const minRemaining = Math.min(...remainingPercents);

    let severity: MaintenanceSeverity | null = null;
    if (minRemaining < -0.1) severity = MaintenanceSeverity.OVERDUE;
    else if (minRemaining <= 0) severity = MaintenanceSeverity.DUE;
    else if (minRemaining < 0.1) severity = MaintenanceSeverity.UPCOMING;

    if (severity !== plan.severity) {
      await this.prisma.maintenancePlan.update({
        where: { id: plan.id },
        data: { severity },
      });
    }

    if (severity === MaintenanceSeverity.OVERDUE || severity === MaintenanceSeverity.DUE) {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const recent = await this.prisma.alert.findFirst({
        where: {
          vehicleId: vehicle.id,
          type: AlertType.MAINTENANCE_DUE,
          createdAt: { gte: sixHoursAgo },
        },
        select: { id: true },
      });
      if (!recent) {
        await this.alerts.createAlert(
          AlertType.MAINTENANCE_DUE,
          vehicle.id,
          vehicle.tenantId,
          `${plan.name} ${severity === 'OVERDUE' ? 'vencida' : 'no prazo'}`,
          { planId: plan.id, planName: plan.name, severity },
        );
      }
    }
  }

  private async fetchSummary(vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { traccarDeviceId: true },
    });
    if (!vehicle?.traccarDeviceId) return null;
    const to = new Date();
    const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
    try {
      const list = await this.traccar.getReportSummary([vehicle.traccarDeviceId], from.toISOString(), to.toISOString());
      return list?.[0] ?? null;
    } catch {
      return null;
    }
  }

  private async getOrThrow(id: string, tenantId: string) {
    const plan = await this.prisma.maintenancePlan.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!plan) throw new NotFoundException('Plano de manutenção não encontrado');
    return plan;
  }
}
