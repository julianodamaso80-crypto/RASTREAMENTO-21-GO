import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from './traccar.service';
import { DeviceRegistryService } from './device-registry.service';

/**
 * Resgata instalações que ficaram sem rastreamento.
 *
 * O vínculo do estoque grava cliente/veículo/rastreador numa transação e só
 * depois fala com o Traccar — de propósito, pra que uma indisponibilidade do
 * Traccar não desfaça uma instalação já concluída em campo. O efeito colateral
 * era grave: o Device ficava sem `traccarDeviceId`, o veículo nunca aparecia no
 * mapa, e o único registro disso era uma linha de warn no log.
 *
 * Este job fecha o buraco: a cada 10 minutos procura instalações órfãs e tenta
 * de novo. Ver docs/PLANO-PRODUCAO-ZERO-ERRO.md P2.1.
 */
@Injectable()
export class TraccarReconcileService {
  private readonly logger = new Logger(TraccarReconcileService.name);

  /** Modelos que não são GPS e nunca vão pro Traccar. */
  private static readonly MODELOS_BLE = [
    'BLE_KTAG',
    'BLE_REDTAG',
    'BLE_AIRTAG_GENERIC',
  ];

  private static readonly STATUS_ATIVO = [
    'INSTALLED',
    'CONFIGURING',
    'ONLINE',
    'OFFLINE',
    'MAINTENANCE',
  ];

  constructor(
    private prisma: PrismaService,
    private traccar: TraccarService,
    private deviceRegistry: DeviceRegistryService,
  ) {}

  @Interval(10 * 60 * 1000)
  async reconciliar(): Promise<number> {
    try {
      const orfaos = await this.prisma.device.findMany({
        where: {
          deletedAt: null,
          traccarDeviceId: null,
          vehicleId: { not: null },
          status: {
            in: TraccarReconcileService.STATUS_ATIVO as never[],
          },
          model: {
            notIn: TraccarReconcileService.MODELOS_BLE as never[],
          },
        },
        select: {
          id: true,
          imei: true,
          vehicleId: true,
          vehicle: { select: { plate: true } },
        },
        take: 50,
      });

      if (orfaos.length === 0) return 0;

      this.logger.warn(
        `${orfaos.length} rastreador(es) instalado(s) sem vínculo no Traccar — tentando resgatar.`,
      );

      let resolvidos = 0;
      for (const device of orfaos) {
        try {
          const placa = device.vehicle?.plate ?? device.imei;
          const existente = await this.traccar.getDeviceByUniqueId(device.imei);
          const traccarDevice =
            existente ?? (await this.traccar.createDevice(placa, device.imei));
          if (!traccarDevice?.id) continue;

          await this.prisma.$transaction([
            this.prisma.device.update({
              where: { id: device.id },
              data: { traccarDeviceId: traccarDevice.id },
            }),
            this.prisma.vehicle.update({
              where: { id: device.vehicleId! },
              data: { traccarDeviceId: traccarDevice.id },
            }),
          ]);
          resolvidos++;
          this.logger.log(
            `Rastreador ${device.imei} (${placa}) religado ao Traccar: device ${traccarDevice.id}.`,
          );
        } catch (erro) {
          this.logger.warn(
            `Não consegui religar ${device.imei} ao Traccar: ${
              erro instanceof Error ? erro.message : erro
            }`,
          );
        }
      }

      if (resolvidos > 0) {
        this.deviceRegistry.notifyDeviceChanged('reconciliação com o Traccar');
      }
      return resolvidos;
    } catch (erro) {
      this.logger.error(
        `Reconciliação com o Traccar falhou: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
      return 0;
    }
  }

  /**
   * Quantos rastreadores instalados estão sem rastreamento agora. Alimenta o
   * dashboard de conectividade — o problema precisa ser VISÍVEL, não só um log.
   */
  async contarOrfaos(tenantId: string): Promise<number> {
    return this.prisma.device.count({
      where: {
        tenantId,
        deletedAt: null,
        traccarDeviceId: null,
        vehicleId: { not: null },
        status: { in: TraccarReconcileService.STATUS_ATIVO as never[] },
        model: { notIn: TraccarReconcileService.MODELOS_BLE as never[] },
      },
    });
  }
}
