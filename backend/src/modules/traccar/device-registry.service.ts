import { Injectable, Logger } from '@nestjs/common';

/**
 * Ponte entre "um rastreador acabou de mudar de veículo" e o gateway do tempo
 * real, sem acoplar os módulos (StockModule não conhece o gateway, e o gateway
 * não pode importar StockModule sem criar ciclo).
 *
 * Existe porque o mapping `traccarDeviceId → tenant/veículo/associado` do
 * gateway só se atualizava a cada 2 minutos: até lá, as posições do rastreador
 * recém-instalado eram simplesmente descartadas e o carro não aparecia no mapa.
 * Ver docs/PLANO-PRODUCAO-ZERO-ERRO.md P0.3.
 *
 * Mesmo padrão já usado em AlertsService.setEmitter / BleTagsService.setEmitter.
 */
@Injectable()
export class DeviceRegistryService {
  private readonly logger = new Logger(DeviceRegistryService.name);
  private refresher: (() => Promise<void>) | null = null;

  /** O gateway se registra no afterInit. */
  setRefresher(fn: () => Promise<void>) {
    this.refresher = fn;
  }

  /**
   * Best-effort de propósito: falhar em atualizar o mapping não pode derrubar
   * uma instalação que já foi concluída — no pior caso o refresh periódico
   * (2 min) resolve.
   */
  notifyDeviceChanged(motivo: string): void {
    if (!this.refresher) return;
    void this.refresher().catch((erro) =>
      this.logger.warn(
        `Refresh de mapping após "${motivo}" falhou: ${
          erro instanceof Error ? erro.message : erro
        }`,
      ),
    );
  }
}
