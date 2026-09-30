import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import {
  normalizeFinancialStatus,
  normalizeSgaStatusLabel,
} from '../hinova/sga-status';
import { decidirTipoVeiculo } from '../hinova/tipo-veiculo';

/**
 * Troca de titularidade: o carro foi vendido (ou mudou de nome no SGA) e o
 * rastreador fica onde está. O veículo passa para o associado que o SGA devolve
 * para a placa — sem retirar e reinstalar nada.
 *
 * É a mesma consulta e a mesma régua do "Associar (SGA)" do Estoque
 * (`StockService.associate`): o servidor rebusca a placa, só passa ATIVO (ou
 * INATIVO liberado por administrador) e o cliente é deduplicado por CPF.
 */
@Injectable()
export class OwnershipTransferService {
  private readonly logger = new Logger(OwnershipTransferService.name);

  constructor(
    private prisma: PrismaService,
    private stock: StockService,
  ) {}

  async transfer(
    tenantId: string,
    vehicleId: string,
    dto: { placa: string; allowInactive?: boolean },
    liberadorAdmin: boolean,
  ) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId, deletedAt: null },
      include: { associate: true },
    });
    if (!vehicle) throw new NotFoundException('Ativo não encontrado.');

    const lookup = await this.stock.lookupSga(tenantId, dto.placa);
    if (!lookup.encontrado) {
      throw new UnprocessableEntityException(
        lookup.motivo || 'Placa não encontrada no SGA.',
      );
    }
    const bloqueio = StockService.motivoDeBloqueio(lookup, dto.placa);
    if (bloqueio) {
      if (!dto.allowInactive) {
        throw new UnprocessableEntityException(
          `${bloqueio} — troca bloqueada. ` +
            'Só um administrador pode liberar a troca assim mesmo.',
        );
      }
      if (!liberadorAdmin) {
        throw new ForbiddenException(
          `${bloqueio}. Somente um administrador pode liberar a troca assim mesmo.`,
        );
      }
    }
    if (!lookup.cliente.cpf) {
      throw new UnprocessableEntityException(
        'SGA não retornou o CPF do cliente para esta placa.',
      );
    }

    const placa = (lookup.veiculo.placa || dto.placa)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const cpf = lookup.cliente.cpf.replace(/\D/g, '');

    // Troca de titularidade é do MESMO veículo. Se a placa consultada já é
    // outro ativo vivo da empresa, o caminho certo é desvincular e instalar —
    // aqui só se mudaria o dono de um carro e se apagaria o outro por engano.
    if (placa !== vehicle.plate) {
      const outro = await this.prisma.vehicle.findFirst({
        where: {
          tenantId,
          plate: placa,
          deletedAt: null,
          id: { not: vehicle.id },
        },
        select: { id: true },
      });
      if (outro) {
        throw new UnprocessableEntityException(
          `A placa ${placa} já é outro ativo desta empresa. ` +
            'Troca de titularidade vale para o mesmo veículo; para mover o rastreador, desvincule e instale de novo.',
        );
      }
    }

    if (
      vehicle.associate &&
      vehicle.associate.cpf.replace(/\D/g, '') === cpf
    ) {
      throw new UnprocessableEntityException(
        `O SGA devolve o mesmo titular (${vehicle.associate.name}) para esta placa. Nada a trocar.`,
      );
    }

    const contato = await this.stock.contatoDaPendencia(tenantId, placa, cpf);
    const situacaoSga = {
      financialStatus: normalizeFinancialStatus(lookup.situacao.financeira),
      financialStatusAt: new Date(),
      sgaStatusLabel: normalizeSgaStatusLabel(lookup.situacao.descricao),
    };
    const { tipo: tipoSga } = decidirTipoVeiculo({
      tipoSga: lookup.veiculo.tipo,
      chassi: lookup.veiculo.chassi,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      // Cliente — dedupe por (tenant, cpf), igual ao associate() do estoque.
      let associate = await tx.associate.findFirst({
        where: { tenantId, cpf, deletedAt: null },
      });
      if (associate) {
        associate = await tx.associate.update({
          where: { id: associate.id },
          data: {
            name: lookup.cliente.nome ?? associate.name,
            hinovaCode: lookup.veiculo.codigoVeiculo ?? associate.hinovaCode,
            ...(associate.phone ? {} : { phone: contato.phone }),
            ...(associate.email ? {} : { email: contato.email }),
          },
        });
      } else {
        associate = await tx.associate.create({
          data: {
            tenantId,
            name: lookup.cliente.nome ?? 'Associado (SGA)',
            cpf,
            phone: contato.phone,
            email: contato.email,
            hinovaCode: lookup.veiculo.codigoVeiculo,
          },
        });
      }

      const atualizado = await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          associateId: associate.id,
          plate: placa,
          chassi: lookup.veiculo.chassi ?? vehicle.chassi,
          model: lookup.veiculo.modelo ?? vehicle.model,
          ...(tipoSga ? { vehicleType: tipoSga } : {}),
          hinovaCode: lookup.veiculo.codigoVeiculo ?? vehicle.hinovaCode,
          lastSync: new Date(),
          // O dono novo começa do zero: enxerga o carro no app e o acesso ao
          // bloqueador volta a depender de um administrador liberar.
          appAccessBlocked: false,
          blockerAccessAllowed: false,
          ...situacaoSga,
        },
        select: { id: true, plate: true },
      });

      return { associate, vehicle: atualizado };
    });

    const de = vehicle.associate
      ? `${vehicle.associate.name} (${vehicle.associate.cpf})`
      : 'ninguém';
    this.logger.warn(
      `Troca de titularidade: ${result.vehicle.plate} saiu de ${de} ` +
        `para ${result.associate.name} (${cpf})` +
        (bloqueio ? ` — liberado por ADMIN: ${bloqueio}` : '') +
        '.',
    );

    return {
      vehicleId: result.vehicle.id,
      plate: result.vehicle.plate,
      from: vehicle.associate
        ? {
            id: vehicle.associate.id,
            name: vehicle.associate.name,
            cpf: vehicle.associate.cpf,
          }
        : null,
      to: { id: result.associate.id, name: result.associate.name, cpf },
    };
  }
}
