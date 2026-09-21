import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assessComms } from './asset-comms';
import { BLE_DEVICE_MODELS } from '../../common/constants/ble-models';
import { filtroBusca } from '../../common/search/termo-busca';
import {
  ativoSoTag,
  casaBusca,
  fatiaCombinada,
  normalizarNome,
  resumoTag,
  separarSoTag,
  tagNoMapa,
  ultimasPosicoes,
  vinculosDaTela,
  vinculosVisiveis,
} from './clients-tags';

// Acentos do cadastro → letra sem acento, no SQL (espelha normalizarNome).
const COM_ACENTO = 'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ';
const SEM_ACENTO = 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy';

/** Situação financeira do ativo no SGA. */
export type FinancialStatus = 'ADIMPLENTE' | 'INADIMPLENTE';

export interface FindAssetsParams {
  search?: string;
  page?: number;
  perPage?: number;
  /**
   * O time interno vê as TAGs (selo no card do rastreador e cards de quem só
   * tem TAG). CLIENT e o app do associado NUNCA — a TAG é segredo interno. O
   * controller passa isto pelo papel do usuário.
   */
  verTags?: boolean;
}

/**
 * Clientes Ativos: associados que já têm veículo/rastreador vinculado (fluxo
 * "Associar cliente e ativo" a partir do estoque).
 *
 * A tela lista por ATIVO, não por cliente — um card por veículo, como no fluxo
 * de operação real ("quem é o dono desta placa?", "quem parou de comunicar?").
 */
@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  /** Teto de itens por página — o front oferece até 500, como o concorrente. */
  private static readonly MAX_PER_PAGE = 500;

  /**
   * Lista paginada de ativos. A busca é única e cobre tudo que o atendimento
   * tem em mãos quando o cliente liga: nome, CPF/CNPJ, telefone, IMEI, chip
   * (ICCID ou linha), placa, chassi, renavam, marca, modelo e cor.
   */
  async findAssets(tenantId: string, params: FindAssetsParams = {}) {
    const page = Math.max(1, Math.trunc(params.page ?? 1));
    const perPage = Math.min(
      ClientsService.MAX_PER_PAGE,
      Math.max(1, Math.trunc(params.perPage ?? 20)),
    );

    const where: Prisma.VehicleWhereInput = {
      tenantId,
      deletedAt: null,
      associateId: { not: null },
      // Ativo é veículo COM rastreador instalado. Desvinculou, o aparelho volta
      // pro estoque e o carro sai desta tela — senão a lista vira depósito de
      // veículo que ninguém rastreia e o total deixa de significar frota
      // monitorada. O veículo continua existindo em /veiculos.
      //
      // TAG Bluetooth não é rastreador: quem está com TAG aparece na tela de
      // TAGs ativas, senão o total desta lista deixaria de significar frota
      // com GPS.
      device: { is: { deletedAt: null, model: { notIn: [...BLE_DEVICE_MODELS] } } },
    };

    // Busca única, mesmos campos em todas as telas do painel: placa, chassi,
    // renavam, marca, modelo, cor, nome, CPF/CNPJ, telefone, IMEI e chip.
    const filtro = filtroBusca(params.search, {
      texto: ['brand', 'model', 'color', 'associate.name'],
      alfanumerico: ['plate', 'chassi', 'renavam'],
      documento: ['associate.cpf'],
      identificador: [
        'device.imei',
        'uniqueId',
        'associate.phone',
        'device.chip.iccid',
        'device.chip.phoneNumber',
      ],
    });
    if (filtro) {
      where.OR = filtro.OR as Prisma.VehicleWhereInput[];
    } else if (params.search?.trim()) {
      // Termo que não pode casar em campo nenhum não devolve a base inteira.
      where.id = '00000000-0000-0000-0000-000000000000';
    }

    // "sergio" tem que achar "SÉRGIO": o contains do Prisma diferencia acento.
    const porNome = await this.associadosPorNome(tenantId, params.search);
    if (porNome.length > 0) {
      where.OR = [...((where.OR as Prisma.VehicleWhereInput[]) ?? []), { associateId: { in: porNome } }];
      delete where.id;
    }

    // IMEI com letra (conta demo "DEMO00000000001"): termo com letra não entra
    // na busca numérica, então casa pelo termo inteiro. Placa nunca está
    // contida num IMEI só de dígitos.
    const alfa = (params.search ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/[A-Z]/.test(alfa)) {
      where.OR = [...((where.OR as Prisma.VehicleWhereInput[]) ?? []), { device: { imei: { contains: alfa } } }];
      delete where.id;
    }

    // Sem TAG (CLIENT e app do associado): exatamente o comportamento antigo.
    if (!params.verTags) {
      const [total, vehicles] = await Promise.all([
        this.prisma.vehicle.count({ where }),
        this.prisma.vehicle.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
          include: {
            associate: true,
            device: { include: { installedByTechnician: true } },
          },
        }),
      ]);
      const lastFix = await this.lastFixTimes(tenantId, vehicles.map((v) => v.id));
      return {
        data: vehicles.map((v) => this.toAsset(v, lastFix.get(v.id) ?? null)),
        meta: { total, page, perPage },
      };
    }

    // Time interno: veículos (rastreador) primeiro, depois quem só tem TAG,
    // numa paginação só. O selo de TAG entra nos veículos com TAG na placa.
    // Sem busca, a lista é a régua do dono (só TAG rastreável). Buscando, toda
    // TAG de carro ATIVO tem que ser achável: a sem posição e a divergente
    // entram, e o selo do card avisa ("sem posição ainda" / "conferir").
    const { visiveis, ocultos } = await vinculosDaTela(this.prisma, tenantId);
    const buscando = !!params.search?.trim();
    const soTag = (buscando ? [...visiveis, ...ocultos] : visiveis)
      .filter((x) =>
        casaBusca(
          {
            plate: x.sga?.plate ?? x.vinculo.plate,
            chassi: x.vinculo.chassi,
            associateName: x.sga?.associateName ?? x.vinculo.associateName,
            associateCpf: x.sga?.cpf ?? x.vinculo.associateCpf,
            serialNumber: x.vinculo.serialNumber,
            outrosSeriais: x.outrosSeriais,
          },
          params.search,
        ),
      );

    // Quem já tem rastreador nosso não vira card de "só TAG": ganha só o selo.
    const { apenasTag, placasComVeiculo } = await separarSoTag(this.prisma, tenantId, soTag);

    // A busca casou a TAG (pelo número de série, por exemplo) de um carro que
    // tem rastreador: o card desse carro é onde a TAG aparece, então ele entra
    // no resultado mesmo sem o termo casar em campo nenhum do veículo.
    if (params.search?.trim() && placasComVeiculo.size > 0) {
      where.OR = [...((where.OR as Prisma.VehicleWhereInput[]) ?? []), { plate: { in: [...placasComVeiculo] } }];
      delete where.id;
    }

    const totalVeiculos = await this.prisma.vehicle.count({ where });
    const total = totalVeiculos + apenasTag.length;
    const { skipVeiculos, takeVeiculos, inicioTag, fimTag } = fatiaCombinada(
      totalVeiculos,
      apenasTag.length,
      page,
      perPage,
    );

    const vehicles =
      takeVeiculos > 0
        ? await this.prisma.vehicle.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: skipVeiculos,
            take: takeVeiculos,
            include: {
              associate: true,
              device: { include: { installedByTechnician: true } },
            },
          })
        : [];
    const lastFix = await this.lastFixTimes(tenantId, vehicles.map((v) => v.id));

    const tagPorPlaca = new Map(soTag.map((x) => [x.vinculo.plate, x]));
    const posVeiculo = await ultimasPosicoes(
      this.prisma,
      tenantId,
      vehicles
        .map((v) => tagPorPlaca.get(v.plate)?.vinculo.serialNumber)
        .filter((s): s is string => !!s),
    );
    const dataVeiculos = vehicles.map((v) => {
      const asset = this.toAsset(v, lastFix.get(v.id) ?? null);
      const x = tagPorPlaca.get(v.plate);
      return x
        ? { ...asset, tag: resumoTag(x.vinculo, posVeiculo.get(x.vinculo.serialNumber)) }
        : asset;
    });

    const pagina = apenasTag.slice(inicioTag, fimTag);
    const posTag = await ultimasPosicoes(
      this.prisma,
      tenantId,
      pagina.map((x) => x.vinculo.serialNumber),
    );
    const dataTags = pagina.map((x) =>
      ativoSoTag(x, posTag.get(x.vinculo.serialNumber)),
    );

    return {
      data: [...dataVeiculos, ...dataTags],
      meta: { total, page, perPage },
    };
  }

  /** Associados cujo nome casa com o termo ignorando acento e espaço repetido. */
  private async associadosPorNome(tenantId: string, termo: string | undefined): Promise<string[]> {
    const nome = normalizarNome(termo);
    if (!/[a-z]/.test(nome)) return [];
    const padrao = `%${nome.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const linhas = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM associates
       WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
         AND regexp_replace(lower(translate(name, ${COM_ACENTO}, ${SEM_ACENTO})), '\\s+', ' ', 'g') LIKE ${padrao}`);
    return linhas.map((l) => l.id);
  }

  /**
   * As TAGs de cliente para o Mapa — todas de uma vez, com a última posição.
   *
   * O conjunto é o MESMO dos cards de "só TAG" de Clientes Ativos (mesmo
   * `vinculosVisiveis` + `separarSoTag`): o Mapa somava só veículos e a tela de
   * clientes somava veículos e TAGs, e o dono via 990 num lugar e 3.835 no
   * outro. Só o time interno chega aqui — o gate é do controller.
   */
  async tagsNoMapa(tenantId: string) {
    const { apenasTag } = await separarSoTag(
      this.prisma,
      tenantId,
      await vinculosVisiveis(this.prisma, tenantId),
    );
    const pos = await ultimasPosicoes(
      this.prisma,
      tenantId,
      apenasTag.map((x) => x.vinculo.serialNumber),
    );
    return apenasTag.map((x) => tagNoMapa(x, pos.get(x.vinculo.serialNumber)));
  }

  /**
   * Última posição com fix de GPS de cada veículo, numa consulta só.
   *
   * `valid: true` e `fixTime` não-nulo são obrigatórios: posição inválida é LBS
   * por torre de celular (erro de quilômetros) e `deviceTime` avança em
   * keep-alive sem fix novo. Mostrar qualquer um dos dois como "GPS" faria um
   * veículo sem sinal parecer rastreado.
   */
  private async lastFixTimes(tenantId: string, vehicleIds: string[]) {
    if (vehicleIds.length === 0) return new Map<string, Date>();

    const rows = await this.prisma.position.groupBy({
      by: ['vehicleId'],
      where: {
        tenantId,
        vehicleId: { in: vehicleIds },
        valid: true,
        fixTime: { not: null },
      },
      _max: { fixTime: true },
    });

    return new Map(
      rows
        .filter((r) => r._max.fixTime)
        .map((r) => [r.vehicleId, r._max.fixTime as Date]),
    );
  }

  private toAsset(
    v: Prisma.VehicleGetPayload<{
      include: {
        associate: true;
        device: { include: { installedByTechnician: true } };
      };
    }>,
    lastFixTime: Date | null,
  ) {
    return {
      id: v.id,
      plate: v.plate,
      brand: v.brand,
      model: v.model,
      vehicleType: v.vehicleType,
      chassi: v.chassi,
      status: v.status,
      createdAt: v.createdAt,
      associate: v.associate
        ? {
            id: v.associate.id,
            name: v.associate.name,
            cpf: v.associate.cpf,
            phone: v.associate.phone,
            email: v.associate.email,
          }
        : null,
      device: v.device
        ? {
            id: v.device.id,
            imei: v.device.imei,
            model: v.device.model,
            status: v.device.status,
            installedAt: v.device.installedAt,
            installLocation: v.device.installLocation,
            /** GPRS: o chip respirou. NÃO prova onde o veículo está. */
            lastConnection: v.device.lastConnection,
            technician: v.device.installedByTechnician
              ? {
                  id: v.device.installedByTechnician.id,
                  name: v.device.installedByTechnician.name,
                }
              : null,
            /** Histórico anterior ao cadastro de técnicos. */
            installedByName: v.device.installedBy,
          }
        : null,
      /** GPS: o único carimbo que prova "o veículo estava AQUI". */
      lastFixTime,
      /**
       * Julgamento do par GPRS/GPS calculado aqui, não na tela: a regra que
       * separa "chip vivo" de "veículo localizado" é a mesma em qualquer
       * cliente e não pode divergir entre eles.
       */
      comms: assessComms(v.device?.lastConnection ?? null, lastFixTime),
      financialStatus: v.financialStatus as FinancialStatus | null,
      financialStatusAt: v.financialStatusAt,
      appAccessBlocked: v.appAccessBlocked,
      sga: { code: v.hinovaCode, statusLabel: v.sgaStatusLabel },
    };
  }

  /**
   * Números da aba Análises: composição da frota e ritmo de instalação.
   *
   * `weekOffset` 0 = semana corrente, 1 = semana passada, e assim por diante —
   * o seletor da tela.
   */
  async assetsSummary(tenantId: string, weekOffset = 0) {
    const where: Prisma.VehicleWhereInput = {
      tenantId,
      deletedAt: null,
      associateId: { not: null },
      // Mesma régua da listagem: sem rastreador não é ativo (e TAG não é
      // rastreador). Contar diferente aqui faria o cabeçalho dizer um número e
      // a lista mostrar outro.
      device: { is: { deletedAt: null, model: { notIn: [...BLE_DEVICE_MODELS] } } },
    };

    const byTypeRows = await this.prisma.vehicle.groupBy({
      by: ['vehicleType'],
      where,
      _count: { _all: true },
    });
    const total = byTypeRows.reduce((n, r) => n + r._count._all, 0);
    const byType = byTypeRows
      .map((r) => ({
        type: r.vehicleType,
        count: r._count._all,
        pct: total ? Number(((r._count._all / total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const [byMonth, week] = await Promise.all([
      this.installationsByMonth(tenantId),
      this.installationsOfWeek(tenantId, weekOffset),
    ]);

    return { total, byType, byMonth, week };
  }

  /** Instalações dos últimos 6 meses, incluindo os meses zerados. */
  private async installationsByMonth(tenantId: string) {
    const start = startOfMonth(addMonths(startOfToday(), -5));

    const devices = await this.prisma.device.findMany({
      where: {
        tenantId,
        deletedAt: null,
        installedAt: { gte: start },
        vehicle: { deletedAt: null },
      },
      select: { installedAt: true },
    });

    const counts = new Map<string, number>();
    for (const d of devices) {
      if (!d.installedAt) continue;
      const key = monthKey(d.installedAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return Array.from({ length: 6 }, (_, i) => {
      const month = addMonths(start, i);
      const key = monthKey(month);
      return { month: key, count: counts.get(key) ?? 0 };
    });
  }

  /**
   * Instalações da semana escolhida, quebradas por dia — a aba dom–sáb da tela.
   * Cada dia traz os ativos instalados, não só o número.
   */
  private async installationsOfWeek(tenantId: string, weekOffset: number) {
    const from = addDays(startOfWeek(startOfToday()), -7 * Math.max(0, weekOffset));
    const to = addDays(from, 7);

    const devices = await this.prisma.device.findMany({
      where: {
        tenantId,
        deletedAt: null,
        installedAt: { gte: from, lt: to },
        vehicle: { deletedAt: null },
      },
      orderBy: { installedAt: 'asc' },
      include: {
        vehicle: { include: { associate: true } },
        installedByTechnician: true,
      },
    });

    const days = Array.from({ length: 7 }, (_, i) => ({
      date: addDays(from, i),
      items: [] as Array<{
        vehicleId: string;
        plate: string;
        brand: string | null;
        model: string | null;
        vehicleType: string;
        imei: string;
        associateName: string | null;
        technicianName: string | null;
      }>,
    }));

    for (const d of devices) {
      if (!d.installedAt || !d.vehicle) continue;
      const index = Math.floor(
        (startOfDay(d.installedAt).getTime() - from.getTime()) / DAY_MS,
      );
      if (index < 0 || index > 6) continue;
      days[index].items.push({
        vehicleId: d.vehicle.id,
        plate: d.vehicle.plate,
        brand: d.vehicle.brand,
        model: d.vehicle.model,
        vehicleType: d.vehicle.vehicleType,
        imei: d.imei,
        associateName: d.vehicle.associate?.name ?? null,
        technicianName: d.installedByTechnician?.name ?? d.installedBy ?? null,
      });
    }

    return {
      offset: weekOffset,
      from,
      to,
      total: days.reduce((n, d) => n + d.items.length, 0),
      days: days.map((d) => ({ ...d, count: d.items.length })),
    };
  }

  /**
   * Corta ou devolve o acesso do cliente a UM ativo no app. Não mexe na senha
   * nem nos outros veículos do mesmo associado.
   */
  async setAppAccess(tenantId: string, vehicleId: string, blocked: boolean) {
    await this.assertVehicle(tenantId, vehicleId);
    const v = await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { appAccessBlocked: blocked },
      select: { id: true, plate: true, appAccessBlocked: true },
    });
    return v;
  }

  /**
   * Override manual da situação financeira. O cron reconsulta o SGA depois e
   * sobrescreve — este caminho existe pro operador que já sabe da negociação
   * antes do SGA refletir.
   */
  async setFinancialStatus(
    tenantId: string,
    vehicleId: string,
    status: FinancialStatus,
  ) {
    await this.assertVehicle(tenantId, vehicleId);
    return this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { financialStatus: status, financialStatusAt: new Date() },
      select: {
        id: true,
        plate: true,
        financialStatus: true,
        financialStatusAt: true,
      },
    });
  }

  /** Corrige quem instalou — o card e a contagem por técnico saem daqui. */
  async setTechnician(
    tenantId: string,
    vehicleId: string,
    technicianId: string,
  ) {
    const vehicle = await this.assertVehicle(tenantId, vehicleId);
    if (!vehicle.device) {
      throw new NotFoundException('Veículo sem rastreador instalado.');
    }

    const technician = await this.prisma.technician.findFirst({
      where: { id: technicianId, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!technician) throw new NotFoundException('Técnico não encontrado.');

    await this.prisma.device.update({
      where: { id: vehicle.device.id },
      data: {
        installedByTechnicianId: technician.id,
        installedBy: technician.name,
      },
    });

    return { vehicleId, technician };
  }

  private async assertVehicle(tenantId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId, deletedAt: null },
      include: { device: true },
    });
    if (!vehicle) throw new NotFoundException('Ativo não encontrado.');
    return vehicle;
  }

  /**
   * Listagem agrupada por cliente — formato da tela anterior a 11/08/2026.
   * Mantida porque o endpoint `/clients` é público na API; a tela não usa mais.
   */
  async findActive(tenantId: string, search?: string) {
    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      vehicles: { some: { deletedAt: null } },
    };
    if (search) {
      const s = search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { cpf: { contains: s.replace(/\D/g, '') } },
        {
          vehicles: {
            some: { plate: { contains: s.toUpperCase() }, deletedAt: null },
          },
        },
      ];
    }

    const associates = await this.prisma.associate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        vehicles: {
          where: { deletedAt: null },
          include: { device: true },
        },
      },
    });

    return associates.map((a) => ({
      id: a.id,
      name: a.name,
      cpf: a.cpf,
      phone: a.phone,
      email: a.email,
      hinovaCode: a.hinovaCode,
      createdAt: a.createdAt,
      vehicles: a.vehicles.map((v) => ({
        id: v.id,
        plate: v.plate,
        model: v.model,
        chassi: v.chassi,
        status: v.status,
        device: v.device
          ? {
              id: v.device.id,
              imei: v.device.imei,
              status: v.device.status,
              installedBy: v.device.installedBy,
              installLocation: v.device.installLocation,
              installedAt: v.device.installedAt,
            }
          : null,
      })),
    }));
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfToday() {
  return startOfDay(new Date());
}

/** Semana começa no domingo — é como o calendário da tela é lido no Brasil. */
function startOfWeek(d: Date) {
  return addDays(startOfDay(d), -d.getDay());
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function addMonths(d: Date, months: number) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

function startOfMonth(d: Date) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
