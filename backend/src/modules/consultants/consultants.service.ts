import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { coletaCompleta, paraLinha, type UsuarioPower } from './consultants.mapper';
import { PowerPanelClient } from './power-panel.client';

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

  /**
   * A base inteira numa chamada só (~4 mil pessoas, poucas centenas de KB comprimidos).
   *
   * Busca, filtro, página e ficha acontecem no navegador: o painel dispara a carga do
   * mapa em toda tela e uma chamada por tecla ou clique entrava na fila atrás dela
   * (medido em 17/09/2026: lista em 0,5 s no servidor e 2 a 4,5 s na tela).
   */
  async listAll(tenantId: string) {
    const [items, ultima] = await Promise.all([
      this.prisma.consultant.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          powerId: true,
          name: true,
          nickname: true,
          email: true,
          document: true,
          phone: true,
          mobile: true,
          office: true,
          officeLabel: true,
          branch: true,
          cooperative: true,
          permissionGroup: true,
          managerName: true,
          active: true,
          statusLabel: true,
          powerCreatedAt: true,
          lastAccessAt: true,
          blockedAt: true,
        },
      }),
      this.prisma.consultant.aggregate({ where: { tenantId }, _max: { syncedAt: true } }),
    ]);
    return { items, lastSyncAt: ultima._max.syncedAt, syncing: this.status.syncing };
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
