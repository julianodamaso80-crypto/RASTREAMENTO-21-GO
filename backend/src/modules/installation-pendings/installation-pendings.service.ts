import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { HINOVA_CLIENT, type IHinovaClient } from '../hinova/hinova.interface';
import { montarFila } from './installation-pendings.mapper';
import type {
  InstallationPendingRow,
  PendingListQuery,
  PendingStats,
  SyncOutcome,
} from './installation-pendings.types';

/**
 * Pendências de instalação de rastreador e TAG, espelhadas do SGA Hinova.
 *
 * A pendência vive em `codigo_tipo_adesao` do veículo:
 *   1  → PENDENTE INSTALAÇÃO DE RASTREADOR
 *   10 → PENDENTE INSTALAÇÃO DE TAG
 * (lista completa em GET /tipo-adesao/listar/todos).
 *
 * Varrer o SGA inteiro leva minutos — 22 mil veículos e 19 mil associados. Por
 * isso a leitura da tela nunca toca o SGA: um cron espelha pra `installation_pendings`
 * e a tela lê o Postgres.
 */
@Injectable()
export class InstallationPendingsService {
  private readonly logger = new Logger(InstallationPendingsService.name);

  /**
   * Lote da varredura. 5.000 (o máximo do SGA) devolve 401 esporádico mesmo com
   * token válido; 2.000 se mostrou estável na coleta de 2026-07-22.
   */
  private static readonly LOTE = 2000;

  /** Trava contra paginação infinita se o SGA parar de encurtar o último lote. */
  private static readonly MAX_PAGINAS = 50;

  private syncing = false;
  private lastSync: SyncOutcome | null = null;

  constructor(
    @Inject(HINOVA_CLIENT) private hinova: IHinovaClient,
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Leitura (tela)
  // ---------------------------------------------------------------------------

  async list(
    tenantId: string,
    query: PendingListQuery,
  ): Promise<InstallationPendingRow[]> {
    const rows = await this.prisma.installationPending.findMany({
      where: {
        tenantId,
        contractDate: { gte: this.dataCorte(query.days) },
        ...(query.type ? { pendingType: query.type } : {}),
        ...(query.city ? { city: query.city } : {}),
        ...(query.search ? this.filtroBusca(query.search) : {}),
      },
      orderBy: [{ protectedValue: 'desc' }, { contractDate: 'asc' }],
      take: query.limit ?? 1000,
    });

    return rows.map((r) => ({
      id: r.id,
      plate: r.plate,
      pendingType: r.pendingType as 'TRACKER' | 'TAG',
      associateName: r.associateName,
      cpf: r.cpf,
      phone: r.phone,
      email: r.email,
      brandModel: r.brandModel,
      vehicleType: r.vehicleType,
      city: r.city,
      neighborhood: r.neighborhood,
      protectedValue: Number(r.protectedValue),
      contractDate: r.contractDate.toISOString().slice(0, 10),
      daysPending: InstallationPendingsService.diasDesde(r.contractDate),
      evaluationTable: r.evaluationTable,
      consultantName: r.consultantName,
      hinovaVehicleCode: r.hinovaVehicleCode,
    }));
  }

  async stats(tenantId: string, days: number): Promise<PendingStats> {
    const rows = await this.prisma.installationPending.findMany({
      where: { tenantId, contractDate: { gte: this.dataCorte(days) } },
      select: { pendingType: true, protectedValue: true },
    });

    const ultimoSync = await this.prisma.installationPending.findFirst({
      where: { tenantId },
      orderBy: { syncedAt: 'desc' },
      select: { syncedAt: true },
    });

    return {
      total: rows.length,
      tracker: rows.filter((r) => r.pendingType === 'TRACKER').length,
      tag: rows.filter((r) => r.pendingType === 'TAG').length,
      exposedValue: rows.reduce((soma, r) => soma + Number(r.protectedValue), 0),
      lastSyncAt: ultimoSync?.syncedAt.toISOString() ?? null,
      syncing: this.syncing,
    };
  }

  async cities(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.installationPending.findMany({
      where: { tenantId, city: { not: null } },
      select: { city: true },
      distinct: ['city'],
      orderBy: { city: 'asc' },
    });
    return rows.map((r) => r.city!).filter(Boolean);
  }

  getSyncStatus(): { syncing: boolean; last: SyncOutcome | null } {
    return { syncing: this.syncing, last: this.lastSync };
  }

  private dataCorte(days: number): Date {
    const corte = new Date();
    corte.setUTCHours(0, 0, 0, 0);
    corte.setUTCDate(corte.getUTCDate() - days);
    return corte;
  }

  private filtroBusca(termo: string) {
    const t = termo.trim();
    return {
      OR: [
        { plate: { contains: t.toUpperCase().replace(/[^A-Z0-9]/g, '') } },
        { associateName: { contains: t, mode: 'insensitive' as const } },
        { cpf: { contains: t.replace(/\D/g, '') } },
      ],
    };
  }

  private static diasDesde(data: Date): number {
    const hoje = new Date();
    hoje.setUTCHours(0, 0, 0, 0);
    return Math.max(
      0,
      Math.floor((hoje.getTime() - data.getTime()) / 86400000),
    );
  }

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduledSync(): Promise<void> {
    if (this.config.get<string>('hinova.syncEnabled') === 'false') return;

    const tenant = await this.prisma.tenant.findFirst({
      where: { active: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!tenant) return;

    try {
      await this.sync(tenant.id);
    } catch (erro) {
      this.logger.error(
        `Sync agendado de pendências falhou: ${erro instanceof Error ? erro.message : erro}`,
      );
    }
  }

  async sync(tenantId: string): Promise<SyncOutcome> {
    if (this.syncing) {
      return this.lastSync ?? { started: true, tracker: 0, tag: 0, total: 0, duration: '0s' };
    }

    this.syncing = true;
    const inicio = Date.now();

    try {
      await this.hinova.authenticate();

      const veiculos = await this.varrer((offset, limite) =>
        this.hinova.listRawActiveVehicles(offset, limite),
      );
      const associados = await this.varrer((offset, limite) =>
        this.hinova.listRawActiveAssociates(offset, limite),
      );

      const linhas = montarFila(veiculos, associados, tenantId);

      // Espelho: o que saiu da pendência no SGA some daqui. Trocar tudo numa
      // transação evita a tela ficar vazia no meio do sync.
      await this.prisma.$transaction([
        this.prisma.installationPending.deleteMany({ where: { tenantId } }),
        this.prisma.installationPending.createMany({ data: linhas }),
      ]);

      const resultado: SyncOutcome = {
        started: false,
        tracker: linhas.filter((l) => l.pendingType === 'TRACKER').length,
        tag: linhas.filter((l) => l.pendingType === 'TAG').length,
        total: linhas.length,
        duration: `${((Date.now() - inicio) / 1000).toFixed(1)}s`,
      };

      this.lastSync = resultado;
      this.logger.log(
        `Pendências sincronizadas: ${resultado.total} (${resultado.tracker} rastreador, ${resultado.tag} TAG) em ${resultado.duration}`,
      );
      return resultado;
    } finally {
      this.syncing = false;
    }
  }

  /** Pagina até o SGA devolver um lote menor que o pedido. */
  private async varrer<T>(
    buscar: (offset: number, limite: number) => Promise<T[]>,
  ): Promise<T[]> {
    const todos: T[] = [];
    for (let pagina = 0; pagina < InstallationPendingsService.MAX_PAGINAS; pagina++) {
      const lote = await buscar(
        pagina * InstallationPendingsService.LOTE,
        InstallationPendingsService.LOTE,
      );
      todos.push(...lote);
      if (lote.length < InstallationPendingsService.LOTE) break;
    }
    return todos;
  }

}
