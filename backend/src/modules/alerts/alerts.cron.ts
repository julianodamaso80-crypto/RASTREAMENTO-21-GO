import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AlertType } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import { AlertsService } from './alerts.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';

/**
 * Detecta veículos OFFLINE comparando `tc_devices.lastUpdate` (Traccar)
 * com `now()`. Threshold: 15 minutos sem comunicação = OFFLINE.
 *
 * Roda a cada 1 minuto. Para cada vehicle ATIVO com `traccarDeviceId`:
 *   - Busca lastUpdate do device no Traccar
 *   - Se >15min E não há Alert OFFLINE recente (<30min) → cria alerta
 *
 * Idempotência via janela de 30min — evita spam quando device fica
 * desconectado por horas. Operador resolve manualmente; quando voltar
 * online, próximo OFFLINE só dispara se ficar fora por mais 15min.
 *
 * Custo: 1 chamada `getDevices()` no Traccar por minuto + 1 query no
 * Prisma com filtro indexado. Aceitável até 5k ativos; em Fase 3 com
 * 20k, mover pra job baseado em delta (Redis cache do lastUpdate).
 */
@Injectable()
export class AlertsCron {
  private readonly logger = new Logger(AlertsCron.name);
  private readonly DEDUP_WINDOW_MS = 30 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    private traccarService: TraccarService,
    private alertsService: AlertsService,
    private settings: TenantSettingsService,
  ) {}

  @Interval(60 * 1000)
  async detectOffline() {
    try {
      const vehicles = await this.prisma.vehicle.findMany({
        where: {
          traccarDeviceId: { not: null },
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          traccarDeviceId: true,
          tenantId: true,
          plate: true,
        },
      });

      if (vehicles.length === 0) return;

      let traccarDevices: Awaited<
        ReturnType<typeof this.traccarService.getDevices>
      >;
      try {
        traccarDevices = await this.traccarService.getDevices();
      } catch (err) {
        // Traccar fora do ar — alerta global (sem spammar por veículo)
        this.logger.warn(
          `Falha ao consultar Traccar pra detectar OFFLINE: ${err instanceof Error ? err.message : err}`,
        );
        return;
      }

      const lastUpdateMap = new Map<number, string | null>();
      for (const d of traccarDevices) {
        lastUpdateMap.set(d.id, d.lastUpdate ?? null);
      }

      const now = Date.now();
      const dedupSince = new Date(now - this.DEDUP_WINDOW_MS);
      let createdCount = 0;

      for (const v of vehicles) {
        if (!v.traccarDeviceId) continue;
        const lastUpdate = lastUpdateMap.get(v.traccarDeviceId);
        if (!lastUpdate) continue;

        const lastMs = new Date(lastUpdate).getTime();
        const offlineFor = now - lastMs;
        const tenantSettings = await this.settings.getForTenant(v.tenantId);
        const offlineThresholdMs = tenantSettings.offlineThresholdMinutes * 60 * 1000;
        if (offlineFor < offlineThresholdMs) continue;

        // Já tem alerta OFFLINE recente? Pula.
        const recent = await this.prisma.alert.findFirst({
          where: {
            vehicleId: v.id,
            type: AlertType.OFFLINE,
            createdAt: { gte: dedupSince },
          },
          select: { id: true },
        });
        if (recent) continue;

        await this.alertsService.notifyOffline(v.id, v.tenantId, lastUpdate);
        createdCount++;
      }

      if (createdCount > 0) {
        this.logger.log(
          `Detecção OFFLINE: ${createdCount} alerta(s) criado(s) de ${vehicles.length} ativos`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Erro inesperado em detectOffline: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
