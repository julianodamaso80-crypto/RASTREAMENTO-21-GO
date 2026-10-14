import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AlertType, Prisma } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import { AlertsService } from './alerts.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';

// Acima desse gap entre heartbeat (device.lastUpdate) e ultima posição GPS
// efetiva (position.fixTime), considera-se que o rastreador está mandando
// só keep-alive sem GPS — possível sabotagem da antena. Igual ao
// STALE_POSITION_MS do frontend pra os dois pontos do sistema concordarem.
// 15 min: tempo após o qual GPS silenciado começa a ser suspeito.
// Antes era 5 min, mas isso gerava falso positivo em carros parados +
// rastreadores que economizam bateria reduzindo taxa de update.
const GPS_SILENT_THRESHOLD_MS = 15 * 60 * 1000;

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
      const porEpisodio = this.dedupPorEpisodio(AlertType.OFFLINE);
      const comAlertaRecente = porEpisodio
        ? null
        : await this.vehiclesComAlertaRecente(
            AlertType.OFFLINE,
            dedupSince,
            vehicles.map((v) => v.tenantId),
          );
      // Início do episódio OFFLINE = último contato do device.
      const candidatos: Array<{ v: (typeof vehicles)[number]; lastUpdate: string; inicio: Date }> = [];

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
        if (comAlertaRecente?.has(v.id)) continue;

        candidatos.push({ v, lastUpdate, inicio: new Date(lastMs) });
      }

      const { criar, suprimidosPorEpisodio } = porEpisodio
        ? await this.filtrarPorEpisodio(AlertType.OFFLINE, candidatos, dedupSince)
        : { criar: candidatos, suprimidosPorEpisodio: 0 };

      let createdCount = 0;
      for (const { v, lastUpdate } of criar) {
        await this.alertsService.notifyOffline(v.id, v.tenantId, lastUpdate);
        createdCount++;
      }

      if (porEpisodio) {
        this.logger.debug(
          `Dedup por episódio OFFLINE: criados=${createdCount} suprimidosPorEpisodio=${suprimidosPorEpisodio}`,
        );
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
      const porEpisodio = this.dedupPorEpisodio(AlertType.GPS_SILENT);
      const comAlertaRecente = porEpisodio
        ? null
        : await this.vehiclesComAlertaRecente(
            AlertType.GPS_SILENT,
            dedupSince,
            vehicles.map((v) => v.tenantId),
          );
      // Início do episódio GPS_SILENT = último fix válido.
      const candidatos: Array<{ v: (typeof vehicles)[number]; heartbeat: Date; inicio: Date }> = [];

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

        // Guard contra falso positivo de carro estacionado: só dispara se a
        // última posição mostrava o veículo EM USO. Carro com ignição off
        // parado é normal — GPS_SILENT aqui é ruído. Suspeita real = "estava
        // rodando e o GPS sumiu".
        //
        // Ignição é bit de status, sempre fresco. Velocidade NÃO: sem sinal de
        // GPS o GT06 repete o fix antigo (fixTime velho, outdated=false) com
        // 2–6 nós de lixo — em 18/08/2026 isso disparou 15 alertas em 30 min
        // pra carro parado em garagem com ignição desligada. Numa posição com
        // fix de 15+ min a velocidade fala do passado; só serve de fallback
        // quando o protocolo não informa ignição.
        const lastIgnition = (position?.attributes as { ignition?: boolean } | undefined)?.ignition;
        const lastSpeed = position?.speed ?? 0;
        const wasInUse =
          lastIgnition === true || (lastIgnition == null && lastSpeed > 1);
        if (!wasInUse) continue;

        if (comAlertaRecente?.has(v.id)) continue;

        candidatos.push({ v, heartbeat, inicio: new Date(positionTime) });
      }

      const { criar, suprimidosPorEpisodio } = porEpisodio
        ? await this.filtrarPorEpisodio(AlertType.GPS_SILENT, candidatos, dedupSince)
        : { criar: candidatos, suprimidosPorEpisodio: 0 };

      let createdCount = 0;
      for (const { v, heartbeat, inicio } of criar) {
        await this.alertsService.notifyGpsSilent(v.id, v.tenantId, inicio, heartbeat);
        createdCount++;
      }

      if (porEpisodio) {
        this.logger.debug(
          `Dedup por episódio GPS_SILENT: criados=${createdCount} suprimidosPorEpisodio=${suprimidosPorEpisodio}`,
        );
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

  /**
   * Veículos que já receberam alerta deste tipo dentro da janela de dedup.
   *
   * Uma consulta por rodada, e não um `findFirst` por veículo: com ~1.400
   * veículos offline eram 1.400 consultas por minuto só para perguntar "já
   * avisei?" (medido em 05/10/2026). A forma da consulta é fixa — sem lista
   * de ids — para não criar uma entrada nova no cache de planos do Prisma a
   * cada tamanho de frota.
   */
  private async vehiclesComAlertaRecente(
    type: AlertType,
    desde: Date,
    tenantIds: string[],
  ): Promise<Set<string>> {
    // tenantId na consulta deixa o indice (tenant_id, type, created_at DESC)
    // servir o dedup; so interessam alertas dos tenants dos veiculos avaliados.
    const recentes = await this.prisma.alert.findMany({
      where: {
        tenantId: { in: [...new Set(tenantIds)] },
        type,
        createdAt: { gte: desde },
      },
      select: { vehicleId: true },
    });
    return new Set(recentes.map((a) => a.vehicleId));
  }

  /**
   * ALERTS_DEDUP_EPISODIO: lista de tipos (`OFFLINE`, `OFFLINE,GPS_SILENT`);
   * `1`/`true` = os dois. Ausente ou vazia = janela de 30 min de hoje.
   */
  private dedupPorEpisodio(type: AlertType): boolean {
    const itens = (process.env.ALERTS_DEDUP_EPISODIO ?? '')
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    return itens.includes(type) || itens.includes('1') || itens.includes('TRUE');
  }

  /**
   * Um alerta por episódio: suprime o veículo cujo último alerta do tipo (de
   * qualquer idade) é mais novo que o início do episódio — ele não voltou desde
   * o aviso. Se voltou (contato/fix depois do último alerta), é episódio novo.
   * A janela de 30 min continua como piso: nunca cria mais que hoje.
   * Só lê a data do último alerta; não lê nem altera status do histórico.
   */
  private async filtrarPorEpisodio<T extends { v: { id: string; tenantId: string }; inicio: Date }>(
    type: AlertType,
    candidatos: T[],
    dedupSince: Date,
  ): Promise<{ criar: T[]; suprimidosPorEpisodio: number }> {
    if (candidatos.length === 0) return { criar: [], suprimidosPorEpisodio: 0 };
    const ultimo = await this.ultimoAlertaPorVeiculo(
      type,
      candidatos.map((c) => c.v.id),
      candidatos.map((c) => c.v.tenantId),
    );
    const criar: T[] = [];
    let suprimidosPorEpisodio = 0;
    for (const c of candidatos) {
      const ultimoEm = ultimo.get(c.v.id);
      if (ultimoEm && ultimoEm >= dedupSince) continue;
      if (ultimoEm && ultimoEm > c.inicio) {
        suprimidosPorEpisodio++;
        continue;
      }
      criar.push(c);
    }
    return { criar, suprimidosPorEpisodio };
  }

  /**
   * Data do último alerta do tipo de cada veículo candidato, numa consulta só.
   *
   * Não usa `findMany({ distinct })`: o `distinct` do Prisma Client, sem o
   * preview `nativeDistinct`, deduplica em memória depois de trazer TODOS os
   * alertas do tipo do tenant (1,3 M OFFLINE abertos). O LATERAL faz uma busca
   * `LIMIT 1` por veículo no índice (vehicle_id, type, created_at DESC). Os ids
   * vão num array só, então a forma da consulta não muda com a frota.
   */
  private async ultimoAlertaPorVeiculo(
    type: AlertType,
    vehicleIds: string[],
    tenantIds: string[],
  ): Promise<Map<string, Date>> {
    const linhas = await this.prisma.$queryRaw<Array<{ vehicle_id: string; created_at: Date }>>(Prisma.sql`
      SELECT v.id AS vehicle_id, a.created_at
        FROM unnest(${vehicleIds}::uuid[]) AS v(id)
        CROSS JOIN LATERAL (
          SELECT created_at FROM alerts
           WHERE vehicle_id = v.id
             AND type = ${type}::"AlertType"
             AND tenant_id = ANY(${[...new Set(tenantIds)]}::uuid[])
           ORDER BY created_at DESC
           LIMIT 1
        ) a`);
    return new Map(linhas.map((l) => [l.vehicle_id, new Date(l.created_at)]));
  }
}
