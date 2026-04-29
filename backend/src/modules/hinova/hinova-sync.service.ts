import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { HINOVA_CLIENT, type IHinovaClient } from './hinova.interface';
import type { HinovaVehicleDto } from './dto/hinova-vehicle.dto';
import type { SyncResultDto, SyncStatusDto } from './dto/sync-result.dto';

@Injectable()
export class HinovaSyncService {
  private readonly logger = new Logger(HinovaSyncService.name);
  private isRunning = false;
  private lastResult: SyncResultDto | null = null;
  private lastSyncTime: string | null = null;

  constructor(
    @Inject(HINOVA_CLIENT) private hinovaClient: IHinovaClient,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  getStatus(): SyncStatusDto {
    const interval =
      this.configService.get<number>('hinova.syncInterval') || 21600000;
    const nextSync = this.lastSyncTime
      ? new Date(new Date(this.lastSyncTime).getTime() + interval).toISOString()
      : null;

    return {
      lastSync: this.lastSyncTime,
      nextSync,
      lastResult: this.lastResult,
      isRunning: this.isRunning,
    };
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduledSync() {
    // Pega o primeiro tenant para sync automático
    const tenant = await this.prisma.tenant.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
    });

    if (tenant) {
      await this.sync(tenant.id);
    }
  }

  async sync(tenantId: string): Promise<SyncResultDto> {
    if (this.isRunning) {
      this.logger.warn('Sync já em execução, ignorando...');
      return (
        this.lastResult || {
          created: 0,
          updated: 0,
          skipped: 0,
          errors: 0,
          duration: '0s',
          startedAt: '',
          finishedAt: '',
        }
      );
    }

    this.isRunning = true;
    const startedAt = new Date();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    this.logger.log(`Iniciando sincronização Hinova para tenant ${tenantId}`);

    try {
      await this.hinovaClient.authenticate();

      let page = 1;
      const perPage = 20;
      let hasMore = true;

      while (hasMore) {
        try {
          const response = await this.hinovaClient.listVehicles(page, perPage);

          for (const hinovaVehicle of response.data) {
            try {
              const result = await this.syncVehicle(hinovaVehicle, tenantId);
              if (result === 'created') created++;
              else if (result === 'updated') updated++;
              else skipped++;
            } catch (error) {
              errors++;
              this.logger.error(
                `Erro ao sincronizar veículo ${hinovaVehicle.placa}: ${error instanceof Error ? error.message : error}`,
              );
            }
          }

          hasMore = page * perPage < response.total;
          page++;
        } catch (error) {
          this.logger.error(
            `Erro na página ${page}: ${error instanceof Error ? error.message : error}`,
          );
          errors++;
          break;
        }
      }
    } catch (error) {
      this.logger.error(
        `Erro na autenticação Hinova: ${error instanceof Error ? error.message : error}`,
      );
      errors++;
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const duration =
      durationMs < 1000
        ? `${durationMs}ms`
        : `${(durationMs / 1000).toFixed(1)}s`;

    const result: SyncResultDto = {
      created,
      updated,
      skipped,
      errors,
      duration,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };

    this.lastResult = result;
    this.lastSyncTime = finishedAt.toISOString();
    this.isRunning = false;

    this.logger.log(
      `Sync finalizado: ${created} criados, ${updated} atualizados, ${skipped} ignorados, ${errors} erros (${duration})`,
    );

    return result;
  }

  private async syncVehicle(
    hinova: HinovaVehicleDto,
    tenantId: string,
  ): Promise<'created' | 'updated' | 'skipped'> {
    // `uniqueId` é unique global — um veículo já cadastrado em outro tenant
    // ou registrado anteriormente neste tenant com placa diferente bate aqui.
    // Buscamos por (plate+tenant) OU uniqueId pra evitar Unique Constraint.
    const hinovaUniqueId = `HINOVA-${hinova.codigoVeiculo}`;
    const existingVehicle = await this.prisma.vehicle.findFirst({
      where: {
        OR: [
          { plate: hinova.placa, tenantId, deletedAt: null },
          { uniqueId: hinovaUniqueId, deletedAt: null },
        ],
      },
    });

    // Mapear status Hinova → VehicleStatus
    const statusMap: Record<string, string> = {
      ATIVO: 'ACTIVE',
      INATIVO: 'INACTIVE',
      INADIMPLENTE: 'DEFAULTING',
    };
    const vehicleStatus = statusMap[hinova.status] || 'ACTIVE';

    // Upsert do associado
    let associateId: string | undefined;
    if (hinova.associado?.cpf) {
      const associate = await this.prisma.associate.upsert({
        where: {
          id:
            existingVehicle?.associateId ||
            '00000000-0000-0000-0000-000000000000',
        },
        update: {
          name: hinova.associado.nome,
          phone: hinova.associado.telefone,
          email: hinova.associado.email,
          hinovaCode: hinova.associado.codigoAssociado,
        },
        create: {
          name: hinova.associado.nome,
          cpf: hinova.associado.cpf,
          rg: hinova.associado.rg,
          birthDate: hinova.associado.dataNascimento
            ? new Date(hinova.associado.dataNascimento)
            : null,
          phone: hinova.associado.telefone,
          email: hinova.associado.email,
          tenantId,
          hinovaCode: hinova.associado.codigoAssociado,
        },
      });
      associateId = associate.id;
    }

    if (existingVehicle) {
      // Atualizar veículo existente
      await this.prisma.vehicle.update({
        where: { id: existingVehicle.id },
        data: {
          chassi: hinova.chassi || existingVehicle.chassi,
          renavam: hinova.renavam || existingVehicle.renavam,
          brand: hinova.marca,
          model: hinova.modelo,
          color: hinova.cor,
          year: hinova.anoModelo,
          status: vehicleStatus as any,
          hinovaCode: hinova.codigoVeiculo,
          lastSync: new Date(),
          ...(associateId && { associateId }),
        },
      });
      return 'updated';
    }

    // Criar novo veículo
    await this.prisma.vehicle.create({
      data: {
        plate: hinova.placa,
        uniqueId: hinovaUniqueId,
        brand: hinova.marca,
        model: hinova.modelo,
        color: hinova.cor,
        year: hinova.anoModelo,
        chassi: hinova.chassi,
        renavam: hinova.renavam,
        status: vehicleStatus as any,
        tenantId,
        hinovaCode: hinova.codigoVeiculo,
        lastSync: new Date(),
        ...(associateId && { associateId }),
      },
    });
    return 'created';
  }
}
