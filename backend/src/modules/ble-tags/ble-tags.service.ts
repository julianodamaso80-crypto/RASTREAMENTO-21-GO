import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';
import { assessPosition } from '../traccar/position-quality';
import { CreateSightingDto } from './dto/create-sighting.dto';
import { FilterSightingsDto } from './dto/filter-sightings.dto';
import { decidirModo, ModoPolling, TURBO_MANUAL_H } from './polling-mode';

const BLE_DEVICE_MODELS = ['BLE_KTAG', 'BLE_REDTAG', 'BLE_AIRTAG_GENERIC'];

/**
 * `codigo_tipo_adesao` do SGA — a lista completa vive no mapper das pendências.
 * Aqui interessam os dois que significam TAG já em uso.
 */
const ADHESION_RASTREADOR_E_TAG = '8';
const ADHESION_SO_TAG = '9';

const ADHESION_POR_TIPO: Record<string, string> = {
  RASTREADOR_E_TAG: ADHESION_RASTREADOR_E_TAG,
  SO_TAG: ADHESION_SO_TAG,
};

export type ActiveTagsQuery = {
  page?: number;
  perPage?: number;
  search?: string;
  tipo?: 'RASTREADOR_E_TAG' | 'SO_TAG';
};

/**
 * Busca por placa, chassi, nome ou CPF.
 *
 * Cada pedaço só entra quando tem o que casar: `contains: ''` casa com TODAS as
 * linhas, então buscar um nome (que não tem dígito) trazia a base inteira de
 * volta como se nada tivesse sido filtrado.
 */
function filtroBuscaSga(termo: string) {
  const t = termo.trim();
  const alfanumerico = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digitos = t.replace(/\D/g, '');

  const OR: Record<string, unknown>[] = [
    { associateName: { contains: t, mode: 'insensitive' as const } },
  ];
  if (alfanumerico) {
    OR.push({ plate: { contains: alfanumerico } });
    OR.push({ chassi: { contains: alfanumerico } });
  }
  // CPF tem 11 dígitos: pedaço curto (o "232" de uma placa) casaria com meio
  // mundo. Só busca por documento quando o termo é mesmo um documento.
  if (digitos.length >= 6) OR.push({ cpf: { contains: digitos } });

  return { OR };
}

// Chave privada da TAG: nunca pode voltar em listagem. Só sai do banco pela
// rota de plano de polling (getPollingPlan), que escolhe os campos a dedo.
const OMIT_BLE_KEY = {
  bleAdvKeyPrivate: true,
  bleAdvKeyHashed: true,
} as const;

export type SightingEmittedPayload = {
  deviceId: string;
  deviceImei: string;
  deviceModel: string;
  vehicleId: string | null;
  sighting: {
    id: string;
    macAddress: string;
    rssi: number | null;
    scannerLat: number | null;
    scannerLng: number | null;
    scannerSource: string | null;
    seenAt: Date;
    accuracy: number | null;
    createdAt: Date;
  };
};

type SightingEmitter = (
  tenantId: string,
  payload: SightingEmittedPayload,
) => void;

@Injectable()
export class BleTagsService {
  private readonly logger = new Logger(BleTagsService.name);
  private emitter: SightingEmitter | null = null;

  private get deviceModel() {
    return (this.prisma as any).device;
  }

  private get sightingModel() {
    return (this.prisma as any).bleSighting;
  }

  private get alertModel() {
    return (this.prisma as any).alert;
  }

  private get sgaVehicleModel() {
    return (this.prisma as any).sgaVehicle;
  }

  private get vehicleModel() {
    return (this.prisma as any).vehicle;
  }

  constructor(
    private prisma: PrismaService,
    // Opcional de propósito: os testes montam o serviço só com o Prisma, e a
    // lista tem que funcionar mesmo com o servidor GPS fora do ar.
    @Optional()
    @Inject(forwardRef(() => TraccarService))
    private traccar?: TraccarService,
  ) {}

  setEmitter(emitter: SightingEmitter) {
    this.emitter = emitter;
  }

  async findAll(tenantId: string) {
    return this.deviceModel.findMany({
      where: {
        tenantId,
        deletedAt: null,
        model: { in: BLE_DEVICE_MODELS },
      },
      omit: OMIT_BLE_KEY,
      include: {
        vehicle: {
          select: { id: true, plate: true, brand: true, model: true },
        },
        bleSightings: {
          take: 1,
          orderBy: { seenAt: 'desc' },
          select: {
            id: true,
            macAddress: true,
            rssi: true,
            scannerLat: true,
            scannerLng: true,
            scannerSource: true,
            seenAt: true,
            accuracy: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * TAGs em uso, na régua do dono: "vinculada a algum veículo e em uso já".
   *
   * A fonte é o espelho do SGA, não o nosso cadastro de equipamento. O SGA é
   * quem sabe quem contratou TAG (`codigo_tipo_adesao` 8 = rastreador+TAG,
   * 9 = só TAG); no 21 GO a TAG só existe como equipamento quando alguém a
   * cadastra com número e MAC, e isso quase nunca aconteceu — listar pelo
   * nosso cadastro mostrava zero enquanto o SGA tinha ~9,7 mil ativos.
   *
   * Quando a TAG TAMBÉM está cadastrada aqui, o card ganha o número, o MAC e a
   * última detecção. Sem isso, ela aparece como cadastro do SGA mesmo — que é
   * a verdade: sabemos que o cliente tem TAG, não sabemos onde ela está.
   */
  async findActive(tenantId: string, query: ActiveTagsQuery = {}) {
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const perPage = Math.min(200, Math.max(1, Math.trunc(query.perPage ?? 20)));

    const where: Record<string, unknown> = {
      tenantId,
      // Só cliente ATIVO: quem está inativo ou negado não é TAG em uso.
      situationLabel: 'ATIVO',
      adhesionCode: query.tipo
        ? ADHESION_POR_TIPO[query.tipo]
        : { in: [ADHESION_RASTREADOR_E_TAG, ADHESION_SO_TAG] },
      ...(query.search ? filtroBuscaSga(query.search) : {}),
    };

    const [total, comRastreador, soTag, rows] = await Promise.all([
      this.sgaVehicleModel.count({ where }),
      this.sgaVehicleModel.count({
        where: { ...where, adhesionCode: ADHESION_RASTREADOR_E_TAG },
      }),
      this.sgaVehicleModel.count({
        where: { ...where, adhesionCode: ADHESION_SO_TAG },
      }),
      this.sgaVehicleModel.findMany({
        where,
        orderBy: [{ contractDate: 'desc' }, { plate: 'asc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    const placas = rows.map((r: any) => r.plate).filter(Boolean);
    const equipamentoPorPlaca = await this.equipamentoPorPlaca(tenantId, placas);
    const posicaoPorTraccarId = await this.posicoesDaPagina(equipamentoPorPlaca);

    return {
      data: rows.map((r: any) => {
        const nosso = equipamentoPorPlaca.get(r.plate?.toUpperCase() ?? '');
        return {
          id: r.id,
          plate: r.plate,
          chassi: r.chassi,
          brandModel: r.brandModel,
          associateName: r.associateName,
          cpf: r.cpf,
          phone: r.phone,
          tipo:
            r.adhesionCode === ADHESION_SO_TAG
              ? 'SO_TAG'
              : 'RASTREADOR_E_TAG',
          contractDate: r.contractDate
            ? r.contractDate.toISOString().slice(0, 10)
            : null,
          hinovaVehicleCode: r.hinovaVehicleCode,
          vehicleId: nosso?.vehicleId ?? null,
          tag: nosso?.tag ?? null,
          // Posição do RASTREADOR do veículo, não da TAG — a TAG não reporta
          // sozinha. A tela diz isso na cara pra ninguém confundir as duas.
          ultimaPosicao:
            (nosso?.traccarDeviceId != null
              ? (posicaoPorTraccarId.get(nosso.traccarDeviceId) ?? null)
              : null),
        };
      }),
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / perPage)),
        comRastreador,
        soTag,
      },
    };
  }

  /**
   * Cruza as placas da página com o nosso cadastro. Só o que está na tela —
   * cruzar a base inteira seria varrer 10 mil linhas pra enfeitar 20.
   */
  private async equipamentoPorPlaca(tenantId: string, placas: string[]) {
    const mapa = new Map<
      string,
      {
        vehicleId: string;
        traccarDeviceId: number | null;
        tag: {
          id: string;
          imei: string;
          model: string;
          brand: string | null;
          macAddress: string | null;
          lastSeenAt: string | null;
        } | null;
      }
    >();
    if (placas.length === 0) return mapa;

    const veiculos = await this.vehicleModel.findMany({
      where: {
        tenantId,
        deletedAt: null,
        plate: { in: placas.map((p) => p.toUpperCase()) },
      },
      select: {
        id: true,
        plate: true,
        traccarDeviceId: true,
        device: {
          select: {
            id: true,
            imei: true,
            model: true,
            brand: true,
            deletedAt: true,
            bleSightings: {
              take: 1,
              orderBy: { seenAt: 'desc' },
              select: { macAddress: true, seenAt: true },
            },
          },
        },
      },
    });

    for (const v of veiculos) {
      const d: any = v.device;
      const ehTag =
        d && !d.deletedAt && BLE_DEVICE_MODELS.includes(d.model as string);
      mapa.set(v.plate.toUpperCase(), {
        vehicleId: v.id,
        traccarDeviceId: v.traccarDeviceId ?? null,
        tag: ehTag
          ? {
              id: d.id,
              imei: d.imei,
              model: d.model,
              brand: d.brand,
              macAddress: d.bleSightings?.[0]?.macAddress ?? null,
              lastSeenAt: d.bleSightings?.[0]?.seenAt
                ? d.bleSightings[0].seenAt.toISOString()
                : null,
            }
          : null,
      });
    }
    return mapa;
  }

  /**
   * Última posição conhecida dos veículos da página, direto do Traccar.
   *
   * Uma chamada só (o Traccar devolve todas as posições de uma vez) e apenas
   * quando a página tem algum veículo nosso ligado ao servidor GPS. Servidor
   * fora do ar não pode derrubar a lista: sem posição, o card mostra o resto.
   */
  private async posicoesDaPagina(
    equipamentoPorPlaca: Map<string, { traccarDeviceId: number | null }>,
  ) {
    const mapa = new Map<
      number,
      {
        latitude: number;
        longitude: number;
        fixTime: string | null;
        address: string | null;
        speed: number;
        confiavel: boolean;
      }
    >();

    const ids = new Set<number>();
    for (const v of equipamentoPorPlaca.values()) {
      if (v.traccarDeviceId != null) ids.add(v.traccarDeviceId);
    }
    if (ids.size === 0 || !this.traccar) return mapa;

    let posicoes: any[];
    try {
      posicoes = await this.traccar.getPositions();
    } catch (erro) {
      this.logger.warn(
        `Traccar indisponível ao montar as TAGs ativas: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
      return mapa;
    }

    const agora = Date.now();
    for (const p of posicoes) {
      if (!ids.has(p.deviceId)) continue;
      const anterior = mapa.get(p.deviceId);
      const fixTime = p.fixTime || p.deviceTime || p.serverTime || null;
      // O Traccar devolve uma posição por device, mas se vier repetida fica a
      // mais recente — posição velha por cima da nova é o pior dos mundos.
      if (anterior?.fixTime && fixTime && anterior.fixTime >= fixTime) continue;
      mapa.set(p.deviceId, {
        latitude: p.latitude,
        longitude: p.longitude,
        fixTime,
        address: p.address ?? null,
        speed: p.speed ?? 0,
        confiavel: assessPosition(p, agora).trustworthy,
      });
    }
    return mapa;
  }

  async findOne(id: string, tenantId: string) {
    const tag = await this.deviceModel.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
        model: { in: BLE_DEVICE_MODELS },
      },
      omit: OMIT_BLE_KEY,
      include: {
        vehicle: {
          select: { id: true, plate: true, brand: true, model: true },
        },
      },
    });
    if (!tag) throw new NotFoundException('TAG BLE não encontrada');
    return tag;
  }

  async listSightings(
    deviceId: string,
    tenantId: string,
    filters: FilterSightingsDto,
  ) {
    await this.findOne(deviceId, tenantId);

    const { page, perPage } = filters;
    const where = { deviceId, tenantId };

    const [data, total] = await Promise.all([
      this.sightingModel.findMany({
        where,
        orderBy: { seenAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.sightingModel.count({ where }),
    ]);

    return { data, meta: { total, page, perPage } };
  }

  async createSighting(dto: CreateSightingDto, tenantId: string) {
    const device = await this.deviceModel.findFirst({
      where: {
        imei: dto.deviceImei,
        tenantId,
        deletedAt: null,
      },
    });

    if (!device) {
      throw new NotFoundException(
        'TAG BLE não encontrada (IMEI inexistente ou pertence a outro tenant)',
      );
    }

    if (!BLE_DEVICE_MODELS.includes(device.model)) {
      throw new BadRequestException(
        'Device informado não é uma TAG BLE (model precisa ser BLE_KTAG, BLE_REDTAG ou BLE_AIRTAG_GENERIC)',
      );
    }

    const seenAt = dto.seenAt ? new Date(dto.seenAt) : new Date();

    // Restart do worker no meio de um backfill reenvia a mesma janela de até
    // 7 dias; sem índice único (um P2002 apareceria pro worker como 500, que
    // ele trata como falha transiente e reenvia pra sempre), o dedupe é feito
    // aqui, por aplicação (ver I3).
    if (dto.hashedAdvKey) {
      const existente = await this.sightingModel.findFirst({
        where: {
          deviceId: device.id,
          hashedAdvKey: dto.hashedAdvKey,
          seenAt,
        },
      });
      if (existente) return existente;
    }

    const sighting = await this.sightingModel.create({
      data: {
        deviceId: device.id,
        macAddress: dto.macAddress,
        rssi: dto.rssi ?? null,
        accuracy: dto.accuracy ?? null,
        seenAt,
        hashedAdvKey: dto.hashedAdvKey,
        counterByte: dto.counterByte,
        scannerLat: dto.scannerLat,
        scannerLng: dto.scannerLng,
        scannerSource: dto.scannerSource,
        tenantId,
      },
    });

    // Backfill entrega relatos fora de ordem (até 7 dias de história); só
    // avança lastConnection, nunca retrocede pra um seenAt mais antigo que o
    // já registrado (ver I2).
    if (!device.lastConnection || seenAt > device.lastConnection) {
      await this.deviceModel.update({
        where: { id: device.id },
        data: { lastConnection: seenAt },
      });
    }

    if (this.emitter) {
      this.emitter(tenantId, {
        deviceId: device.id,
        deviceImei: device.imei,
        deviceModel: device.model,
        vehicleId: device.vehicleId ?? null,
        sighting: {
          id: sighting.id,
          macAddress: sighting.macAddress,
          rssi: sighting.rssi,
          scannerLat: sighting.scannerLat,
          scannerLng: sighting.scannerLng,
          scannerSource: sighting.scannerSource,
          seenAt: sighting.seenAt,
          accuracy: sighting.accuracy,
          createdAt: sighting.createdAt,
        },
      });
    }

    this.logger.debug(
      `BLE sighting registrada: device=${device.id} rssi=${sighting.rssi}`,
    );

    return sighting;
  }

  /**
   * O que o worker deve buscar e com que pressa. Toda a regra de ritmo mora
   * aqui: o worker não conhece alerta nem veículo, só obedece o intervalo.
   *
   * `agora` é injetável para o teste não depender do relógio da máquina.
   */
  async getPollingPlan(tenantId: string, agora: Date = new Date()) {
    const tags = await this.deviceModel.findMany({
      where: {
        tenantId,
        deletedAt: null,
        model: { in: BLE_DEVICE_MODELS },
      },
      select: {
        imei: true,
        vehicleId: true,
        bleAdvKeyPrivate: true,
        bleAdvKeyHashed: true,
        bleTurboUntil: true,
      },
    });

    const comChave = tags.filter(
      (t: any) => t.bleAdvKeyPrivate && t.bleAdvKeyHashed,
    );
    if (comChave.length === 0) return { tags: [] };

    const alertas = await this.alertModel.findMany({
      where: {
        tenantId,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        vehicleId: {
          in: comChave.map((t: any) => t.vehicleId).filter(Boolean),
        },
      },
      select: { vehicleId: true, type: true },
    });

    const porVeiculo = new Map<string, string[]>();
    for (const a of alertas) {
      const lista = porVeiculo.get(a.vehicleId) ?? [];
      lista.push(a.type);
      porVeiculo.set(a.vehicleId, lista);
    }

    // TAG em repouso (IDLE) não entra no plano: com 52 mil TAGs, mandar o
    // worker consultar a frota inteira em ritmo lento ainda é o padrão que
    // bane a conta na Apple. Só quem tem ocorrência aberta custa requisição.
    const tagsParaConsultar = comChave
      .map((t: any) => {
        const decisao = decidirModo({
          alertasAbertos: t.vehicleId
            ? (porVeiculo.get(t.vehicleId) ?? [])
            : [],
          turboUntil: t.bleTurboUntil,
          agora,
        });
        return {
          deviceImei: t.imei,
          privateKey: t.bleAdvKeyPrivate,
          hashedAdvKey: t.bleAdvKeyHashed,
          mode: decisao.modo as ModoPolling,
          intervalSeconds: decisao.intervalSeconds,
          backfillHours: decisao.backfillHours,
        };
      })
      .filter((t: any) => t.mode === 'TURBO');

    return { tags: tagsParaConsultar };
  }

  /**
   * Liga o ritmo acelerado por decisão do operador — para o caso em que a
   * suspeita chega por telefone antes de qualquer alerta automático.
   */
  async acionarTurbo(id: string, tenantId: string, agora: Date = new Date()) {
    await this.findOne(id, tenantId);

    const bleTurboUntil = new Date(
      agora.getTime() + TURBO_MANUAL_H * 60 * 60 * 1000,
    );

    await this.deviceModel.update({
      where: { id },
      data: { bleTurboUntil },
    });

    this.logger.log(
      `Ritmo acelerado ligado na TAG ${id} até ${bleTurboUntil.toISOString()}`,
    );

    return { bleTurboUntil };
  }
}
