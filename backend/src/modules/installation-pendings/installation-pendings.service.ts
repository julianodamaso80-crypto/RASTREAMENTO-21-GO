import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { HINOVA_CLIENT, type IHinovaClient } from '../hinova/hinova.interface';
import { montarFila, diasPendente } from './installation-pendings.mapper';
import { GeocodingService } from './geocoding.service';
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
export class InstallationPendingsService implements OnModuleInit {
  private readonly logger = new Logger(InstallationPendingsService.name);

  /**
   * Lote da varredura. 5.000 (o máximo do SGA) devolve 401 esporádico mesmo com
   * token válido; 2.000 se mostrou estável na coleta de 2026-07-22.
   */
  private static readonly LOTE = 2000;

  /** Trava contra paginação infinita se o SGA parar de encurtar o último lote. */
  private static readonly MAX_PAGINAS = 50;

  private syncing = false;
  private syncStartedAt: Date | null = null;
  private lastSync: SyncOutcome | null = null;
  private lastError: string | null = null;

  constructor(
    @Inject(HINOVA_CLIENT) private hinova: IHinovaClient,
    private prisma: PrismaService,
    private config: ConfigService,
    private geocoding: GeocodingService,
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
      chassi: r.chassi,
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
      daysPending: diasPendente(r.contractDate),
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

  getSyncStatus(): {
    syncing: boolean;
    startedAt: string | null;
    elapsedSeconds: number | null;
    last: SyncOutcome | null;
    lastError: string | null;
  } {
    return {
      syncing: this.syncing,
      startedAt: this.syncStartedAt?.toISOString() ?? null,
      elapsedSeconds: this.syncStartedAt
        ? Math.round((Date.now() - this.syncStartedAt.getTime()) / 1000)
        : null,
      last: this.lastSync,
      lastError: this.lastError,
    };
  }

  /**
   * Tira a placa da fila no instante em que o rastreador é instalado, sem
   * esperar o próximo sync. Chamado pelo vínculo do estoque (painel e técnico).
   *
   * Best-effort de propósito: falhar aqui não pode derrubar uma instalação que
   * já foi concluída — no pior caso a linha some no sync seguinte.
   */
  async removeByPlate(tenantId: string, plate: string): Promise<number> {
    const normalizada = (plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!normalizada) return 0;

    try {
      const { count } = await this.prisma.installationPending.deleteMany({
        where: { tenantId, plate: normalizada },
      });
      if (count > 0) {
        this.logger.log(
          `Placa ${normalizada} saiu da fila de pendências (instalação concluída).`,
        );
      }
      return count;
    } catch (erro) {
      this.logger.warn(
        `Não consegui remover ${normalizada} da fila de pendências: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
      return 0;
    }
  }

  private dataCorte(days: number): Date {
    const corte = new Date();
    corte.setUTCHours(0, 0, 0, 0);
    corte.setUTCDate(corte.getUTCDate() - days);
    return corte;
  }

  private filtroBusca(termo: string) {
    const t = termo.trim();
    const alfanumerico = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return {
      OR: [
        { plate: { contains: alfanumerico } },
        { chassi: { contains: alfanumerico } },
        { associateName: { contains: t, mode: 'insensitive' as const } },
        { cpf: { contains: t.replace(/\D/g, '') } },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  /**
   * Carga inicial: se a fila está vazia, o próximo horário do cron pode estar a
   * horas de distância e a tela fica zerada até lá — parecendo defeito. Roda uma
   * vez, em background, e só quando não há nada gravado.
   *
   * Espera 30s pro boot terminar: a varredura é longa e não pode competir com a
   * subida do resto da aplicação.
   */
  onModuleInit(): void {
    if (this.config.get<string>('hinova.pendingsSyncEnabled') === 'false') return;

    setTimeout(() => {
      void this.cargaInicial();
    }, 30_000).unref();
  }

  private async cargaInicial(): Promise<void> {
    try {
      const jaTem = await this.prisma.installationPending.count();
      if (jaTem > 0) return;

      const tenant = await this.prisma.tenant.findFirst({
        where: { active: true, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      if (!tenant) return;

      this.logger.log('Fila de pendências vazia — disparando carga inicial.');
      await this.sync(tenant.id);
    } catch (erro) {
      this.logger.error(
        `Carga inicial de pendências falhou: ${erro instanceof Error ? erro.message : erro}`,
      );
    }
  }

  /**
   * 09:00 e 17:00 de Brasília, todos os dias. Duas passadas cobrem o que foi
   * vendido de manhã e o que foi instalado no correr do dia.
   */
  @Cron('0 0 9,17 * * *', { timeZone: 'America/Sao_Paulo' })
  async scheduledSync(): Promise<void> {
    // Flag própria: HINOVA_SYNC_ENABLED desliga o sync que escreve em
    // Vehicle/Associate e está false em prod. Este aqui só reescreve a tabela
    // espelho, então segue ligado por padrão.
    if (this.config.get<string>('hinova.pendingsSyncEnabled') === 'false') return;

    const tenant = await this.prisma.tenant.findFirst({
      where: { active: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!tenant) return;

    this.logger.log('Sync agendado de pendências disparado.');
    try {
      await this.sync(tenant.id);
    } catch (erro) {
      this.logger.error(
        `Sync agendado de pendências falhou: ${erro instanceof Error ? erro.message : erro}`,
      );
    }
  }

  /**
   * Dispara a varredura em background e devolve na hora.
   *
   * A varredura leva minutos e o Cloudflare corta requisição em ~100s — manter
   * a resposta HTTP aberta até o fim nunca ia funcionar pelo botão da tela.
   * Quem chama acompanha por getSyncStatus().
   */
  startSync(tenantId: string): { started: boolean; alreadyRunning: boolean } {
    if (this.syncing) return { started: false, alreadyRunning: true };

    void this.sync(tenantId).catch((erro) => {
      this.logger.error(
        `Sync de pendências falhou: ${erro instanceof Error ? erro.message : erro}`,
      );
    });

    return { started: true, alreadyRunning: false };
  }

  async sync(tenantId: string): Promise<SyncOutcome> {
    if (this.syncing) {
      return this.lastSync ?? { started: true, tracker: 0, tag: 0, total: 0, duration: '0s' };
    }

    this.syncing = true;
    this.syncStartedAt = new Date();
    this.lastError = null;
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

      // Geocodifica os CEPs (cache cobre o que já foi resolvido antes) e preenche
      // lat/lng — é o que alimenta a rota inteligente. Best-effort: CEP que não
      // resolve fica sem coordenada e cai na lista "sem localização".
      const coords = await this.geocoding.resolverLote(
        linhas.map((l) => ({
          cep: l.cep ?? '',
          street: l.street,
          number: l.number,
          city: l.city,
          state: 'RJ',
        })),
      );
      let comCoord = 0;
      for (const l of linhas) {
        const c = l.cep ? coords.get(l.cep) : undefined;
        if (c) {
          l.lat = c.lat;
          l.lng = c.lng;
          comCoord++;
        }
      }

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

      this.logger.log(
        `Geocoding: ${comCoord}/${linhas.length} pendências com coordenada.`,
      );

      this.lastSync = resultado;
      this.logger.log(
        `Pendências sincronizadas: ${resultado.total} (${resultado.tracker} rastreador, ${resultado.tag} TAG) em ${resultado.duration}`,
      );
      return resultado;
    } catch (erro) {
      this.lastError = erro instanceof Error ? erro.message : String(erro);
      throw erro;
    } finally {
      this.syncing = false;
      this.syncStartedAt = null;
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
