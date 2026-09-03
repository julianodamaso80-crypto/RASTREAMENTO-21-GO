import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  HINOVA_CLIENT,
  type HinovaLookupResult,
  type IHinovaClient,
} from '../hinova/hinova.interface';
import { montarFila, diasPendente } from './installation-pendings.mapper';
import { GeocodingService } from './geocoding.service';
import { SgaMirrorService } from './sga-mirror.service';
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
   * Lote da varredura. Medido ao vivo em 2026-07-23 no offset 0: lote 500 = 5s,
   * 1.000 = 9,5s, 2.000 = 39s — e o tempo ainda cresce com o offset. O lote de
   * 2.000 estourava o timeout sob a lentidão do SGA; 1.000 responde rápido e
   * dobra a folga sem multiplicar demais o número de páginas.
   */
  private static readonly LOTE = 1000;

  /** Trava contra paginação infinita se o SGA parar de encurtar o último lote. */
  private static readonly MAX_PAGINAS = 50;

  /** Espaçamento entre páginas pra não bater no rate limit do SGA (406). */
  private static readonly PAUSA_ENTRE_PAGINAS_MS = 2500;

  /**
   * Limite da transação que regrava a fila. Medido em produção: 9.167 ms para
   * 8.449 linhas. O default do Prisma é 5.000 ms — folga nenhuma. 120s cobre a
   * fila crescendo bastante e ainda denuncia banco travado de verdade.
   */
  private static readonly TIMEOUT_GRAVACAO_MS = 120_000;

  private syncing = false;
  private syncStartedAt: Date | null = null;
  private lastSync: SyncOutcome | null = null;
  private lastError: string | null = null;

  constructor(
    @Inject(HINOVA_CLIENT) private hinova: IHinovaClient,
    private prisma: PrismaService,
    private config: ConfigService,
    private geocoding: GeocodingService,
    private mirror: SgaMirrorService,
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
   * Segunda fonte pro vínculo do estoque quando o lookup ao vivo do SGA falha.
   *
   * `/buscar/situacao-financeira-veiculo` é um endpoint FINANCEIRO: responde
   * 406 "Não foram encontrados boletos" enquanto o primeiro boleto não sai — o
   * caso normal do veículo recém-vendido que está recebendo rastreador (55% das
   * instalações de ago/2026). O espelho vem do /listar/veiculo do próprio SGA,
   * só entra veículo ATIVO nele, e traz CPF, nome, telefone e código do veículo.
   * Aceita placa OU chassi (moto nova sem placa só tem chassi).
   *
   * Devolve null quando o veículo não está no espelho — aí o motivo do SGA
   * ao vivo é o que vale.
   */
  async lookupNoEspelho(
    tenantId: string,
    placaOuChassi: string,
  ): Promise<HinovaLookupResult | null> {
    const ident = (placaOuChassi || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (ident.length < 7) return null;

    const p = await this.prisma.installationPending.findFirst({
      where: { tenantId, OR: [{ plate: ident }, { chassi: ident }] },
      orderBy: { syncedAt: 'desc' },
    });
    if (!p) return null;

    return {
      encontrado: true,
      ativo: true,
      fonte: 'espelho',
      cliente: { nome: p.associateName || null, cpf: p.cpf || null },
      veiculo: {
        placa: p.plate || null,
        chassi: p.chassi || null,
        codigoModelo: null,
        modelo: p.brandModel || null,
        codigoVeiculo: p.hinovaVehicleCode || null,
      },
      situacao: {
        codigo: '1',
        descricao: 'ATIVO',
        financeira: null,
        dataVencimento: null,
      },
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
      // Placa OU chassi: moto nova ainda sem placa entra na fila só com o
      // chassi, e é pelo chassi que o técnico a vincula.
      const { count } = await this.prisma.installationPending.deleteMany({
        where: {
          tenantId,
          OR: [{ plate: normalizada }, { chassi: normalizada }],
        },
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
      // Espelho cadastral tem carga própria (SgaMirrorService.cargaInicial) —
      // aqui só a fila de pendências, senão são duas varreduras do SGA no boot.
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
      this.marco(`veiculos ${veiculos.length}`, inicio);

      const associados = await this.varrer((offset, limite) =>
        this.hinova.listRawActiveAssociates(offset, limite),
      );
      this.marco(`associados ${associados.length}`, inicio);

      const linhasSga = montarFila(veiculos, associados, tenantId);
      this.marco(`fila montada ${linhasSga.length}`, inicio);

      // O espelho é reconstruído do zero a cada sync, e o SGA só deixa de
      // listar a placa quando alguém troca o tipo_adesao lá dentro — coisa que
      // a operação faz manualmente, às vezes dias depois. Sem este filtro, a
      // placa que ACABAMOS de instalar reaparece na fila e pode ser mandada de
      // novo pra rota de um técnico. Ver P1.3 do plano.
      const { linhas, removidasPorInstalacao } = await this.tirarJaInstaladas(
        linhasSga,
        tenantId,
      );

      // Rede de segurança: SGA devolvendo lista vazia (ou quase) por falha
      // silenciosa não pode apagar a fila inteira da operação. Ver P1.4.
      const jaGravadas = await this.prisma.installationPending.count({
        where: { tenantId },
      });
      if (jaGravadas > 0 && linhas.length < jaGravadas * 0.3) {
        const aviso =
          `SGA devolveu ${linhas.length} pendência(s) contra ${jaGravadas} ` +
          'já gravadas (queda acima de 70%). Espelho preservado — verifique o SGA.';
        this.lastError = aviso;
        this.logger.error(aviso);
        throw new Error(aviso);
      }

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
      this.marco(`geocoding ${comCoord}/${linhas.length}`, inicio);

      // Espelho: o que saiu da pendência no SGA some daqui. Trocar tudo numa
      // transação evita a tela ficar vazia no meio do sync.
      //
      // Callback em vez da forma em array porque só o callback aceita
      // `timeout`: a forma em array herda o default global de 5s do
      // PrismaClient, e apagar+regravar 8.449 linhas levou 9.167 ms em
      // produção (02/09/2026, 20:45 UTC). O sync agendado abortou inteiro —
      // nada gravado e o espelho cadastral nem chegou a rodar.
      await this.prisma.$transaction(
        async (tx) => {
          await tx.installationPending.deleteMany({ where: { tenantId } });
          await tx.installationPending.createMany({ data: linhas });
        },
        { timeout: InstallationPendingsService.TIMEOUT_GRAVACAO_MS },
      );
      this.marco('fila gravada', inicio);

      // Espelho cadastral: o vínculo do estoque consulta por placa, e o SGA não
      // tem busca por placa que funcione sem boleto. Reaproveita os ativos já
      // lidos acima e varre só as outras situações. Best-effort: falhar aqui não
      // pode invalidar a fila de pendências, que já está gravada.
      try {
        await this.mirror.sincronizar(tenantId, veiculos);
        this.marco('espelho cadastral', inicio);
      } catch (erro) {
        this.logger.error(
          `Espelho cadastral do SGA falhou: ${erro instanceof Error ? erro.message : erro}`,
        );
      }

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
      if (removidasPorInstalacao > 0) {
        this.logger.log(
          `${removidasPorInstalacao} placa(s) ignorada(s): já têm rastreador instalado aqui (SGA ainda não atualizou o tipo de adesão).`,
        );
      }

      // Paradas de rota que perderam a pendência (contrato cancelado no SGA)
      // não podem continuar mandando técnico à casa do cliente. Ver P1.5.
      await this.cancelarParadasSemPendencia(tenantId);

      this.lastSync = resultado;
      // warn, não log: em produção o logger corta `info` e o fim do sync — a
      // única linha que diz se ele concluiu — nunca aparecia no `docker logs`.
      this.logger.warn(
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

  /**
   * Status de Device que significam "o rastreador já está no carro". A placa
   * correspondente não é mais pendência, não importa o que o SGA diga.
   */
  private static readonly STATUS_INSTALADO = [
    'INSTALLED',
    'CONFIGURING',
    'ONLINE',
    'OFFLINE',
    'MAINTENANCE',
  ];

  /**
   * Remove da fila as placas que já têm rastreador instalado aqui dentro.
   *
   * É o conserto do caso mais perigoso do ciclo: instalar hoje, o SGA continuar
   * marcando "pendente instalação" (a baixa lá é manual) e a placa voltar na
   * próxima varredura — indo parar de novo numa rota de instalação. Casa por
   * placa e, pra veículo sem emplacamento, por chassi.
   */
  private async tirarJaInstaladas(
    linhas: ReturnType<typeof montarFila>,
    tenantId: string,
  ): Promise<{
    linhas: ReturnType<typeof montarFila>;
    removidasPorInstalacao: number;
  }> {
    const instalados = await this.prisma.device.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: InstallationPendingsService.STATUS_INSTALADO as never[] },
        vehicleId: { not: null },
      },
      select: { vehicle: { select: { plate: true, chassi: true } } },
    });

    const normalizar = (v?: string | null) =>
      (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    const placas = new Set<string>();
    const chassis = new Set<string>();
    for (const d of instalados) {
      const placa = normalizar(d.vehicle?.plate);
      if (placa) placas.add(placa);
      const chassi = normalizar(d.vehicle?.chassi);
      if (chassi) chassis.add(chassi);
    }

    if (placas.size === 0 && chassis.size === 0) {
      return { linhas, removidasPorInstalacao: 0 };
    }

    const filtradas = linhas.filter((l) => {
      const placa = normalizar(l.plate);
      const chassi = normalizar(l.chassi);
      if (placa && placas.has(placa)) return false;
      if (chassi && chassis.has(chassi)) return false;
      return true;
    });

    return {
      linhas: filtradas,
      removidasPorInstalacao: linhas.length - filtradas.length,
    };
  }

  /**
   * Cancela paradas de rota cuja pendência não existe mais no espelho e que
   * também não viraram instalação.
   *
   * A parada é um snapshot: sem isto, contrato cancelado no SGA continuaria
   * mandando o técnico à casa do cliente. Parada de placa já instalada não
   * entra aqui — essa vira DONE no momento da instalação.
   */
  private async cancelarParadasSemPendencia(tenantId: string): Promise<void> {
    try {
      const paradas = await this.prisma.routeStop.findMany({
        where: {
          status: 'PENDING',
          route: { tenantId, status: 'PENDING' },
        },
        select: { id: true, plate: true, hinovaVehicleCode: true, routeId: true },
      });
      if (!paradas.length) return;

      const [pendencias, instalados] = await Promise.all([
        this.prisma.installationPending.findMany({
          where: { tenantId },
          select: { plate: true, hinovaVehicleCode: true },
        }),
        this.prisma.device.findMany({
          where: {
            tenantId,
            deletedAt: null,
            status: {
              in: InstallationPendingsService.STATUS_INSTALADO as never[],
            },
            vehicleId: { not: null },
          },
          select: { vehicle: { select: { plate: true } } },
        }),
      ]);

      const vivas = new Set<string>();
      for (const p of pendencias) {
        if (p.plate) vivas.add(`P:${p.plate}`);
        if (p.hinovaVehicleCode) vivas.add(`C:${p.hinovaVehicleCode}`);
      }
      const jaInstaladas = new Set(
        instalados
          .map((d) => (d.vehicle?.plate ?? '').toUpperCase())
          .filter(Boolean),
      );

      const orfas = paradas.filter((s) => {
        const placa = (s.plate ?? '').toUpperCase();
        if (placa && jaInstaladas.has(placa)) return false; // vira DONE, não CANCELLED
        if (placa && vivas.has(`P:${placa}`)) return false;
        if (s.hinovaVehicleCode && vivas.has(`C:${s.hinovaVehicleCode}`)) {
          return false;
        }
        return true;
      });
      if (!orfas.length) return;

      await this.prisma.routeStop.updateMany({
        where: { id: { in: orfas.map((s) => s.id) } },
        data: {
          status: 'CANCELLED',
          note: 'Pendência saiu do SGA — não instalar sem confirmar',
        },
      });

      // Rota sem nenhuma parada pendente está encerrada.
      for (const routeId of new Set(orfas.map((s) => s.routeId))) {
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

      this.logger.warn(
        `${orfas.length} parada(s) de rota cancelada(s): a pendência saiu do SGA.`,
      );
    } catch (erro) {
      // Best-effort: falhar aqui não pode derrubar um sync que já deu certo.
      this.logger.warn(
        `Não consegui reconciliar as paradas de rota: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
    }
  }

  /**
   * Carimba heap e tempo de cada etapa do sync.
   *
   * Em 03/09/2026, 12:50 UTC, o backend inteiro caiu com
   * "FATAL ERROR: Reached heap limit Allocation failed" — heap em 2.031 MB de
   * um teto de 2.096 MB, 50 minutos depois de o cron das 9h ter disparado.
   * A varredura acumulada foi medida em só 32 MB para os 27 mil veículos, ou
   * seja, o consumo vem de outro ponto do sync e não dá pra descobrir qual sem
   * carimbo por etapa. Sai em `warn` de propósito: em produção o logger corta
   * `info` (ver LOG_LEVEL no app.module) e `log()` nunca chegaria ao operador.
   */
  private marco(etapa: string, desde: number): void {
    const heap = Math.round(process.memoryUsage().heapUsed / 1048576);
    const rss = Math.round(process.memoryUsage().rss / 1048576);
    const seg = ((Date.now() - desde) / 1000).toFixed(1);
    this.logger.warn(
      `Sync SGA [${etapa}]: ${seg}s acumulados · heap ${heap} MB · rss ${rss} MB`,
    );
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
      // Pausa entre páginas. Medido ao vivo 2026-07-23: bater página após página
      // sem pausa faz o SGA devolver 406 intermitente (rate limit) — requests
      // isolados sempre respondem 200. 2,5s de espaçamento estabiliza a varredura.
      await new Promise((r) =>
        setTimeout(r, InstallationPendingsService.PAUSA_ENTRE_PAGINAS_MS),
      );
    }
    return todos;
  }
}
