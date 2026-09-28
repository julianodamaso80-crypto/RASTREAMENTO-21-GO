import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../boletos/push.service';

/** GT06 às vezes oscila a ignição em segundos: um aviso por veículo e sentido nesse intervalo. */
export const INTERVALO_MINIMO_MS = 2 * 60 * 1000;

export function textoDaIgnicao(placa: string, ligou: boolean, quando: Date): string {
  const hora = quando.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
  return `A chave do veículo ${placa} foi ${ligou ? 'ligada' : 'desligada'} às ${hora}.`;
}

/**
 * Push de chave ligada/desligada pro dono do veículo — só pra quem ligou a
 * opção no app. O painel interno continua recebendo o alerta como sempre.
 */
@Injectable()
export class IgnitionPushService {
  private readonly logger = new Logger(IgnitionPushService.name);
  private ultimoAviso = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** Nunca lança: roda solto (`void`) dentro do processamento de posição. */
  async avisar(vehicleId: string, tenantId: string, ligou: boolean, agora = new Date()): Promise<void> {
    const chave = `${vehicleId}:${ligou ? 'on' : 'off'}`;
    const anterior = this.ultimoAviso.get(chave);
    if (anterior !== undefined && agora.getTime() - anterior < INTERVALO_MINIMO_MS) return;

    try {
      const v = await this.prisma.vehicle.findFirst({
        where: { id: vehicleId, tenantId, deletedAt: null, appAccessBlocked: false },
        select: {
          plate: true,
          associate: {
            select: { id: true, deletedAt: true, notifyIgnitionOn: true, notifyIgnitionOff: true },
          },
        },
      });
      const a = v?.associate;
      if (!v || !a || a.deletedAt) return;
      if (ligou ? !a.notifyIgnitionOn : !a.notifyIgnitionOff) return;

      this.ultimoAviso.set(chave, agora.getTime());
      await this.push.enviar(a.id, tenantId, textoDaIgnicao(v.plate, ligou, agora), { rota: '/(tabs)' });
    } catch (err) {
      this.logger.warn(`push de ignição não saiu (veículo ${vehicleId}): ${(err as Error).message}`);
    }
  }
}
