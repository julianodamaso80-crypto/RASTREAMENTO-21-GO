import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { HINOVA_CLIENT, type IHinovaClient } from '../hinova/hinova.interface';
import {
  normalizeFinancialStatus,
  normalizeSgaStatusLabel,
} from '../hinova/sga-status';

/**
 * Mantém a situação do ativo no SGA (financeira + estado do veículo) espelhada
 * no banco, pra tela de Clientes Ativos abrir instantânea.
 *
 * Por que espelhar em vez de consultar na hora: a única consulta que a
 * integração consegue fazer é `GET /buscar/situacao-financeira-veiculo/{placa}`
 * — uma placa por chamada. Consultar durante o request faria a tela levar
 * segundos por card. O SGA também degrada sob carga, então a varredura é
 * sequencial e com pausa entre placas.
 */
@Injectable()
export class AssetsSgaSyncService {
  private readonly logger = new Logger(AssetsSgaSyncService.name);
  private rodando = false;

  /** Pausa entre placas — o SGA responde pior quanto mais apertamos. */
  private static readonly PAUSA_MS = 400;

  constructor(
    private prisma: PrismaService,
    @Inject(HINOVA_CLIENT) private hinova: IHinovaClient,
  ) {}

  /** 04:00 de Brasília: fora do horário de operação e do sync de pendências. */
  @Cron('0 0 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async scheduledSync(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({
      where: { active: true, deletedAt: null },
      select: { id: true },
    });
    for (const t of tenants) {
      try {
        await this.sync(t.id);
      } catch (erro) {
        this.logger.error(
          `Sync de situação SGA falhou no tenant ${t.id}: ${
            erro instanceof Error ? erro.message : erro
          }`,
        );
      }
    }
  }

  /**
   * Percorre os ativos do tenant e atualiza a situação de cada um.
   *
   * Falha numa placa não derruba a varredura: o SGA responde 406 para placa que
   * ele não conhece, e um ativo que saiu de lá é justamente o que a tela
   * precisa mostrar.
   */
  async sync(tenantId: string): Promise<{ total: number; atualizados: number }> {
    if (this.rodando) {
      this.logger.warn('Sync de situação SGA já em andamento — ignorando.');
      return { total: 0, atualizados: 0 };
    }
    this.rodando = true;

    try {
      const veiculos = await this.prisma.vehicle.findMany({
        where: { tenantId, deletedAt: null, associateId: { not: null } },
        select: { id: true, plate: true },
        orderBy: { createdAt: 'asc' },
      });

      let atualizados = 0;
      for (const v of veiculos) {
        if (!v.plate) continue;
        try {
          const lookup = await this.hinova.lookupByPlate(v.plate);
          if (!lookup.encontrado) continue;

          await this.prisma.vehicle.update({
            where: { id: v.id },
            data: {
              financialStatus: normalizeFinancialStatus(
                lookup.situacao.financeira,
              ),
              financialStatusAt: new Date(),
              sgaStatusLabel: normalizeSgaStatusLabel(lookup.situacao.descricao),
            },
          });
          atualizados += 1;
        } catch (erro) {
          this.logger.warn(
            `Situação SGA da placa ${v.plate} não atualizada: ${
              erro instanceof Error ? erro.message : erro
            }`,
          );
        }
        await pausa(AssetsSgaSyncService.PAUSA_MS);
      }

      this.logger.log(
        `Situação SGA sincronizada: ${atualizados}/${veiculos.length} ativos.`,
      );
      return { total: veiculos.length, atualizados };
    } finally {
      this.rodando = false;
    }
  }
}

function pausa(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
