import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { filtroBusca } from '../../common/search/termo-busca';
import { coletaCompleta, paraLinha, type UsuarioPower } from './consultants.mapper';
import { PowerPanelClient } from './power-panel.client';

export type FiltroStatus = 'ativo' | 'bloqueado';

export interface ConsultantListQuery {
  search?: string;
  status?: FiltroStatus;
  office?: number;
  page: number;
}

export interface SyncStatus {
  syncing: boolean;
  lastSyncAt: Date | null;
  lastError: string | null;
  lastTotal: number | null;
}

/** 1.000 por página: medido em 17/09/2026, 4.225 usuários em 5 páginas de ~3 s. */
const TAMANHO_PAGINA = 1000;
/** Trava: a base tem ~4 mil pessoas; 30 páginas é folga de 7x antes de desconfiar. */
const MAX_PAGINAS = 30;
const LOTE_GRAVACAO = 250;
const POR_PAGINA_TELA = 50;

/**
 * Consultores da 21 GO, espelhados do painel do Power CRM.
 *
 * A tela nunca fala com o Power: um cron copia a base para `consultants` e a
 * aba lê o Postgres. Assim o painel não depende do Power estar de pé para
 * mostrar o telefone de quem vendeu.
 */
@Injectable()
export class ConsultantsService implements OnModuleInit {
  private readonly logger = new Logger(ConsultantsService.name);
  private status: SyncStatus = { syncing: false, lastSyncAt: null, lastError: null, lastTotal: null };

  constructor(
    private prisma: PrismaService,
    private power: PowerPanelClient,
    private config: ConfigService,
  ) {}

  private get habilitado(): boolean {
    return this.config.get<string>('power.syncEnabled') !== 'false' && this.power.configurado;
  }

  /** Carga inicial só com a tabela vazia — não repete a coleta a cada deploy. */
  onModuleInit(): void {
    setTimeout(() => {
      void (async () => {
        try {
          if (!this.habilitado) return;
          if ((await this.prisma.consultant.count()) > 0) return;
          const tenantId = await this.tenantPrincipal();
          if (tenantId) await this.sincronizar(tenantId);
        } catch (erro) {
          this.logger.error(`Carga inicial de consultores falhou: ${mensagem(erro)}`);
        }
      })();
    }, 30_000).unref();
  }

  @Cron('0 */30 * * * *', { timeZone: 'America/Sao_Paulo' })
  async sincronizacaoAgendada(): Promise<void> {
    if (!this.habilitado) return;
    const tenantId = await this.tenantPrincipal();
    if (tenantId) await this.sincronizar(tenantId).catch(() => undefined);
  }

  /** Dispara a coleta em background e volta na hora (o Cloudflare corta request longo). */
  iniciarSincronizacao(tenantId: string): { alreadyRunning: boolean } {
    if (this.status.syncing) return { alreadyRunning: true };
    void this.sincronizar(tenantId).catch(() => undefined);
    return { alreadyRunning: false };
  }

  syncStatus(): SyncStatus {
    return this.status;
  }

  async sincronizar(tenantId: string): Promise<number> {
    if (this.status.syncing) return 0;
    this.status = { ...this.status, syncing: true };
    const inicio = new Date();
    try {
      const usuarios: UsuarioPower[] = [];
      let anunciados = 0;
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const resp = await this.power.listarUsuarios(pagina, TAMANHO_PAGINA);
        anunciados = resp.totalElements;
        if (!resp.content?.length) break;
        usuarios.push(...resp.content);
        // O Power já mentiu no totalPages: para por página vazia OU pelo total.
        if (pagina + 1 >= resp.totalPages && usuarios.length >= anunciados) break;
      }

      const unicos = [...new Map(usuarios.map((u) => [u.id, u])).values()];
      for (let i = 0; i < unicos.length; i += LOTE_GRAVACAO) {
        const lote = unicos.slice(i, i + LOTE_GRAVACAO).map((u) => paraLinha(u, tenantId));
        await this.prisma.$transaction(
          lote.map((linha) =>
            this.prisma.consultant.upsert({
              where: { tenantId_powerId: { tenantId, powerId: linha.powerId } },
              create: { ...linha, syncedAt: inicio },
              update: { ...linha, syncedAt: inicio, deletedAt: null },
            }),
          ),
        );
      }

      if (coletaCompleta(unicos.length, anunciados)) {
        const removidos = await this.prisma.consultant.updateMany({
          where: { tenantId, deletedAt: null, syncedAt: { lt: inicio } },
          data: { deletedAt: new Date() },
        });
        if (removidos.count) this.logger.log(`${removidos.count} consultores saíram do Power`);
      } else {
        this.logger.warn(
          `Coleta do Power incompleta (${unicos.length} de ${anunciados}) — ninguém marcado como removido`,
        );
      }

      this.status = { syncing: false, lastSyncAt: new Date(), lastError: null, lastTotal: unicos.length };
      this.logger.log(`Consultores sincronizados do Power: ${unicos.length}`);
      return unicos.length;
    } catch (erro) {
      this.status = { ...this.status, syncing: false, lastError: mensagem(erro) };
      this.logger.error(`Sincronização de consultores falhou: ${mensagem(erro)}`);
      throw erro;
    }
  }

  async list(tenantId: string, q: ConsultantListQuery) {
    const base = { tenantId, deletedAt: null };
    const busca = q.search?.trim()
      ? (filtroBusca(q.search, {
          texto: ['name', 'nickname', 'email', 'managerName', 'cooperative'],
          documento: ['document'],
          identificador: ['mobile', 'phone'],
        }) ?? { OR: [{ id: '00000000-0000-0000-0000-000000000000' }] })
      : {};
    const where = {
      ...base,
      ...busca,
      ...(q.status ? { active: q.status === 'ativo' } : {}),
      ...(q.office ? { office: q.office } : {}),
    };

    const [items, total, ativos, bloqueados, cargos, ultima] = await Promise.all([
      this.prisma.consultant.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: q.page * POR_PAGINA_TELA,
        take: POR_PAGINA_TELA,
        select: {
          id: true,
          name: true,
          email: true,
          mobile: true,
          phone: true,
          officeLabel: true,
          cooperative: true,
          active: true,
          statusLabel: true,
        },
      }),
      this.prisma.consultant.count({ where }),
      this.prisma.consultant.count({ where: { ...base, active: true } }),
      this.prisma.consultant.count({ where: { ...base, active: false } }),
      this.prisma.consultant.groupBy({
        by: ['office', 'officeLabel'],
        where: base,
        _count: { _all: true },
        orderBy: { office: 'asc' },
      }),
      this.prisma.consultant.aggregate({ where: { tenantId }, _max: { syncedAt: true } }),
    ]);

    return {
      items,
      total,
      page: q.page,
      pageSize: POR_PAGINA_TELA,
      stats: { active: ativos, blocked: bloqueados },
      offices: cargos
        .filter((c) => c.office !== null)
        .map((c) => ({ office: c.office as number, label: c.officeLabel ?? `Cargo ${c.office}`, count: c._count._all })),
      lastSyncAt: ultima._max.syncedAt,
      syncing: this.status.syncing,
    };
  }

  async findOne(tenantId: string, id: string) {
    const consultor = await this.prisma.consultant.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!consultor) throw new NotFoundException('Consultor não encontrado');
    return consultor;
  }

  private async tenantPrincipal(): Promise<string | null> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { active: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
