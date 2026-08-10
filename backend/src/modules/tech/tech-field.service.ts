import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { TraccarService } from '../traccar/traccar.service';
import {
  assessPosition,
  distanceMeters,
} from '../traccar/position-quality';
import { HINOVA_CLIENT, type IHinovaClient } from '../hinova/hinova.interface';
import { FinishInstallDto } from './dto/finish-install.dto';

/** Acima disso a posição não serve pra confirmar a instalação. */
const FIX_FRESCO_MS = 5 * 60 * 1000;

/**
 * Distância máxima aceitável entre o rastreador e o celular do técnico.
 * 500m cobre folgadamente erro de GPS urbano (prédio, garagem coberta) sem
 * deixar passar "o rastreador está em outro bairro".
 */
const DISTANCIA_MAX_M = 500;

export interface SignalResult {
  /** Heartbeat: o módulo/chip está conversando com o servidor. */
  online: boolean;
  lastUpdate: string | null;
  /** GPS de verdade: fix válido, recente e confiável. */
  gpsOk: boolean;
  /** Posição real reportada, quando confiável. */
  position: { latitude: number; longitude: number; fixTime: string } | null;
  satellites: number | null;
  /** Distância até o técnico, quando ele mandou a própria coordenada. */
  distanceM: number | null;
  /** A conferência completa passou (GPS ok E, se informado, perto do técnico). */
  checkOk: boolean;
  /** Frase pronta pra tela — linguagem do técnico, não do sistema. */
  motivo: string | null;
}

@Injectable()
export class TechFieldService {
  private readonly logger = new Logger(TechFieldService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly traccar: TraccarService,
    @Inject(HINOVA_CLIENT) private readonly hinova: IHinovaClient,
  ) {}

  /** Equipamentos reservados pro técnico logado. Nunca vaza item de outro. */
  async assignments(technicianId: string, tenantId: string) {
    return this.prisma.stockItem.findMany({
      where: {
        tenantId,
        assignedTechnicianId: technicianId,
        associatedAt: null,
        deletedAt: null,
      },
      orderBy: { assignedAt: 'desc' },
      select: {
        id: true,
        imei: true,
        iccid: true,
        line: true,
        operator: true,
        server: true,
        status: true,
        assignedAt: true,
      },
    });
  }

  /** Consulta a placa no SGA antes de finalizar. */
  async lookup(placa: string) {
    return this.hinova.lookupByPlate(placa);
  }

  /**
   * Confere se o rastreador está REALMENTE funcionando antes de finalizar.
   *
   * Até 2026-08-10 esta checagem respondia só `device.status === 'online'` —
   * heartbeat do chip, que fica verde mesmo com a antena de GPS arrancada. A
   * instalação era dada como boa e o defeito só aparecia no dia do roubo.
   * Agora exige fix de GPS válido, recente e — quando o técnico manda a própria
   * coordenada — a menos de 500m dele. Ver P0.2 do plano.
   */
  async signal(
    stockItemId: string,
    technicianId: string,
    tenantId: string,
    techLat?: number,
    techLng?: number,
  ): Promise<SignalResult> {
    const item = await this.findAssignedOrFail(
      stockItemId,
      technicianId,
      tenantId,
    );

    const vazio = (motivo: string): SignalResult => ({
      online: false,
      lastUpdate: null,
      gpsOk: false,
      position: null,
      satellites: null,
      distanceM: null,
      checkOk: false,
      motivo,
    });

    let device: Awaited<ReturnType<typeof this.traccar.getDeviceByUniqueId>>;
    try {
      device = await this.traccar.getDeviceByUniqueId(item.imei);
    } catch {
      return vazio('servidor GPS indisponível — tente de novo em instantes');
    }
    if (!device) {
      return vazio('rastreador ainda não apareceu no servidor GPS');
    }

    const online = device.status === 'online';

    let posicao: Awaited<ReturnType<typeof this.traccar.getPositions>>[number] | undefined;
    try {
      const posicoes = await this.traccar.getPositions(device.id);
      posicao = posicoes[posicoes.length - 1];
    } catch {
      posicao = undefined;
    }

    if (!posicao) {
      return {
        ...vazio(
          online
            ? 'chip conectado, mas o GPS ainda não mandou posição — aguarde a céu aberto'
            : 'rastreador ainda não se conectou',
        ),
        online,
        lastUpdate: device.lastUpdate ?? null,
      };
    }

    const qualidade = assessPosition(posicao);
    const fix = posicao.fixTime || posicao.deviceTime;
    const idadeFix = fix ? Date.now() - Date.parse(fix) : Infinity;
    const fixFresco = Number.isFinite(idadeFix) && idadeFix <= FIX_FRESCO_MS;
    const gpsOk = qualidade.trustworthy && fixFresco;

    const satellites =
      (posicao.attributes?.sat as number | undefined) ??
      (posicao.attributes?.satellites as number | undefined) ??
      null;

    const temCoordTecnico =
      typeof techLat === 'number' && typeof techLng === 'number';
    const distanceM =
      gpsOk && temCoordTecnico
        ? distanceMeters(
            { lat: posicao.latitude, lng: posicao.longitude },
            { lat: techLat!, lng: techLng! },
          )
        : null;

    const pertoDoTecnico = distanceM === null || distanceM <= DISTANCIA_MAX_M;
    const checkOk = gpsOk && pertoDoTecnico;

    return {
      online,
      lastUpdate: device.lastUpdate ?? null,
      gpsOk,
      position: gpsOk
        ? {
            latitude: posicao.latitude,
            longitude: posicao.longitude,
            fixTime: fix,
          }
        : null,
      satellites,
      distanceM,
      checkOk,
      motivo: this.explicar({
        online,
        qualidadeOk: qualidade.trustworthy,
        motivoQualidade: qualidade.reason,
        fixFresco,
        distanceM,
        pertoDoTecnico,
      }),
    };
  }

  /** Traduz o diagnóstico técnico pra frase que o instalador entende. */
  private explicar(d: {
    online: boolean;
    qualidadeOk: boolean;
    motivoQualidade?: string;
    fixFresco: boolean;
    distanceM: number | null;
    pertoDoTecnico: boolean;
  }): string | null {
    if (!d.qualidadeOk) {
      if (d.motivoQualidade === 'approximate' || d.motivoQualidade === 'bad-accuracy') {
        return 'posição veio por antena de celular, não por GPS — leve o veículo pra céu aberto';
      }
      if (d.motivoQualidade === 'null-island' || d.motivoQualidade === 'invalid') {
        return 'GPS sem sinal válido — confira a antena';
      }
      return 'posição não confiável — confira a instalação da antena';
    }
    if (!d.fixFresco) {
      return 'a última posição de GPS está velha — aguarde o rastreador atualizar';
    }
    if (!d.pertoDoTecnico) {
      return `o rastreador está a ${this.formatarDistancia(d.distanceM!)} de você — confira se é o equipamento certo`;
    }
    if (!d.online) {
      return 'GPS confirmado, mas o chip está fora do ar no momento';
    }
    return null;
  }

  private formatarDistancia(m: number): string {
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
  }

  /**
   * Finaliza a instalação reusando exatamente o motor do painel, mas só depois
   * da conferência de GPS — o técnico precisa confirmar explicitamente pra
   * finalizar com a conferência reprovada (fica registrado no Device).
   */
  async finish(
    stockItemId: string,
    technicianId: string,
    technicianName: string,
    tenantId: string,
    dto: FinishInstallDto,
  ) {
    await this.findAssignedOrFail(stockItemId, technicianId, tenantId);

    const conferencia = await this.signal(
      stockItemId,
      technicianId,
      tenantId,
      dto.techLat,
      dto.techLng,
    );

    if (!conferencia.checkOk && !dto.overrideGpsCheck) {
      // 422 com o diagnóstico: a tela mostra o motivo e oferece "finalizar
      // assim mesmo". Bloquear de vez travaria instalação em garagem coberta.
      throw new GpsCheckFailedException(conferencia);
    }

    const resultado = await this.stock.associate(stockItemId, tenantId, {
      placa: dto.placa,
      technicianName,
      technicianId,
      installLocation: dto.installLocation,
    });

    // Carimbo de auditoria: com que posição e a que distância a instalação foi
    // aceita. Best-effort — não desfaz um vínculo já concluído.
    try {
      await this.prisma.device.update({
        where: { id: resultado.deviceId },
        data: {
          installCheckFixTime: conferencia.position
            ? new Date(conferencia.position.fixTime)
            : null,
          installCheckLat: conferencia.position?.latitude ?? null,
          installCheckLng: conferencia.position?.longitude ?? null,
          installCheckDistanceM: conferencia.distanceM,
        },
      });
    } catch (erro) {
      this.logger.warn(
        `Não consegui gravar a conferência de GPS do device ${resultado.deviceId}: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
    }

    if (!conferencia.checkOk) {
      this.logger.warn(
        `Instalação finalizada COM override de GPS: placa ${dto.placa}, técnico ${technicianName} — ${conferencia.motivo}`,
      );
    }

    return { ...resultado, gpsCheck: conferencia };
  }

  /**
   * 404 (não 403) quando o item existe mas é de outro técnico — não confirma a
   * existência do IMEI pra quem não tem direito a ele.
   */
  private async findAssignedOrFail(
    id: string,
    technicianId: string,
    tenantId: string,
  ) {
    const item = await this.prisma.stockItem.findFirst({
      where: {
        id,
        tenantId,
        assignedTechnicianId: technicianId,
        associatedAt: null,
        deletedAt: null,
      },
      select: { id: true, imei: true },
    });
    if (!item) throw new NotFoundException('Equipamento não está na sua lista');
    return item;
  }
}

/** 422 com o diagnóstico completo, pra tela poder oferecer o override. */
export class GpsCheckFailedException extends UnprocessableEntityException {
  constructor(check: SignalResult) {
    super({
      message:
        check.motivo ?? 'Não consegui confirmar a posição do rastreador.',
      error: 'GPS_CHECK_FAILED',
      statusCode: 422,
      gpsCheck: check,
    });
  }
}
