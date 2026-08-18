import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { StockTraccarService } from '../stock/stock-traccar.service';
import {
  DeviceHealthService,
  type EnergiaDiagnostico,
} from '../traccar/device-health.service';
import { FinishInstallDto } from './dto/finish-install.dto';

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
  /** Tensão da bateria do veículo — prova o fio de alimentação. */
  energia: EnergiaDiagnostico;
  /** Estado da ignição — prova o fio de ignição. */
  ignicao: { reportada: boolean; ligada: boolean | null };
  /** A conferência completa passou (GPS, energia, ignição e distância). */
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
    private readonly stockTraccar: StockTraccarService,
    private readonly deviceHealth: DeviceHealthService,
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

  /**
   * Consulta a placa (ou chassi) antes de finalizar. Mesmo caminho do painel:
   * SGA ao vivo e, se o veículo ainda não tem boleto, o espelho de pendências.
   */
  async lookup(tenantId: string, placaOuChassi: string) {
    return this.stock.lookupSga(tenantId, placaOuChassi);
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

    // Garante o equipamento no servidor GPS antes de perguntar: rastreador que
    // nunca foi cadastrado lá tem tudo o que manda descartado pelo Traccar.
    await this.stockTraccar.ensureDevice(item);

    const health = await this.deviceHealth.diagnose(item.imei, {
      refLat: techLat,
      refLng: techLng,
      ensureDevice: true,
    });

    return {
      online: health.comunicando,
      lastUpdate: health.lastUpdate,
      gpsOk: health.gps.ok,
      position:
        health.gps.ok &&
        health.gps.latitude !== null &&
        health.gps.longitude !== null
          ? {
              latitude: health.gps.latitude,
              longitude: health.gps.longitude,
              fixTime: health.gps.fixTime ?? '',
            }
          : null,
      satellites: health.gps.satellites,
      distanceM: health.distanceM,
      energia: health.energia,
      ignicao: health.ignicao,
      checkOk: health.checkOk,
      // A tela do técnico mostra uma frase só: a primeira é a mais grave, já
      // que o diagnóstico devolve na ordem chip → GPS → energia → ignição.
      motivo: health.motivos[0] ?? null,
    };
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
      select: { id: true, imei: true, traccarDeviceId: true },
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
