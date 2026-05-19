import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AlertType } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import { AlertsService } from './alerts.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';

// Acima desse gap entre heartbeat (device.lastUpdate) e ultima posição GPS
// efetiva (position.fixTime), considera-se que o rastreador está mandando
// só keep-alive sem GPS — possível sabotagem da antena. Igual ao
// STALE_POSITION_MS do frontend pra os dois pontos do sistema concordarem.
const GPS_SILENT_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutos

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

  /**
   * Detecta GPS silenciado: rastreador continua online (heartbeat vivo) mas
   * a última `position` parou de atualizar há mais de GPS_SILENT_THRESHOLD_MS.
   *
   * É a contrapartida do detector OFFLINE — OFFLINE pega o caso de "sumiu
   * totalmente"; este aqui pega o caso pior: "rastreador vivo mas GPS morto".
   * O sintoma típico é um veículo roubado com a antena coberta ou arrancada,
   * onde o módulo SIM continua respondendo. Sem este detector, a UI mostraria
   * "parado" (após STALE_POSITION_MS) mas nenhum alerta seria gerado.
   *
   * Lê tc_positions direto no DB do Traccar via API REST. Compara fixTime da
   * última posição com agora. Dedup de 30min como no detector OFFLINE.
   */
  @Interval(60 * 1000)
  async detectGpsSilent() {
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

      const [traccarDevices, lastPositions] = await Promise.all([
        this.traccarService.getDevices().catch(() => null),
        this.traccarService.getPositions().catch(() => null),
      ]);
      if (!traccarDevices || !lastPositions) {
        this.logger.warn('Traccar indisponível pra detectar GPS_SILENT');
        return;
      }

      const deviceMap = new Map<number, (typeof traccarDevices)[number]>();
      for (const d of traccarDevices) deviceMap.set(d.id, d);

      const positionMap = new Map<number, (typeof lastPositions)[number]>();
      for (const p of lastPositions) positionMap.set(p.deviceId, p);

      const now = Date.now();
      const dedupSince = new Date(now - this.DEDUP_WINDOW_MS);
      let createdCount = 0;

      for (const v of vehicles) {
        if (!v.traccarDeviceId) continue;
        const device = deviceMap.get(v.traccarDeviceId);
        if (!device || device.status !== 'online') continue;

        const heartbeat = device.lastUpdate ? new Date(device.lastUpdate) : null;
        if (!heartbeat) continue;
        const heartbeatAge = now - heartbeat.getTime();
        // Se heartbeat também tá atrasado, é caso OFFLINE — deixa o outro
        // detector cuidar.
        if (heartbeatAge > 2 * 60 * 1000) continue;

        const position = positionMap.get(v.traccarDeviceId);
        const positionTime = position?.fixTime || position?.deviceTime;
        if (!positionTime) continue; // sem position alguma → não dá pra avaliar

        const positionAge = now - new Date(positionTime).getTime();
        if (positionAge < GPS_SILENT_THRESHOLD_MS) continue;

        const recent = await this.prisma.alert.findFirst({
          where: {
            vehicleId: v.id,
            type: AlertType.GPS_SILENT,
            createdAt: { gte: dedupSince },
          },
          select: { id: true },
        });
        if (recent) continue;

        await this.alertsService.notifyGpsSilent(
          v.id,
          v.tenantId,
          new Date(positionTime),
          heartbeat,
        );
        createdCount++;
      }

      if (createdCount > 0) {
        this.logger.warn(
          `Detecção GPS_SILENT: ${createdCount} alerta(s) CRÍTICO(s) criado(s)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Erro inesperado em detectGpsSilent: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
