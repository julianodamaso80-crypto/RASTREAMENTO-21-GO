import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { FilterStockDto } from './dto/filter-stock.dto';
import { AssociateStockDto } from './dto/associate-stock.dto';
import { AssignStockDto } from './dto/assign-stock.dto';
import {
  HINOVA_CLIENT,
  type HinovaLookupResult,
  type IHinovaClient,
} from '../hinova/hinova.interface';
import {
  normalizeFinancialStatus,
  normalizeSgaStatusLabel,
} from '../hinova/sga-status';
import { TraccarService } from '../traccar/traccar.service';
import { DeviceRegistryService } from '../traccar/device-registry.service';
import {
  DeviceHealthService,
  type DeviceHealth,
} from '../traccar/device-health.service';
import { InstallationPendingsService } from '../installation-pendings/installation-pendings.service';
import { SgaMirrorService } from '../installation-pendings/sga-mirror.service';
import { RoutesService } from '../installation-pendings/routes.service';
import { StockTraccarService } from './stock-traccar.service';
import { PositionsService } from '../positions/positions.service';
import { ValidateStockDto } from './dto/validate-stock.dto';

type ParsedRow = {
  imei: string;
  iccid: string | null;
  line: string | null;
  operator: string | null;
  status: string | null;
  server: string | null;
  registeredAt: Date | null;
  activatedAt: Date | null;
};

export type ImportResult = {
  imported: number; // linhas criadas
  updated: number; // linhas atualizadas (IMEI já existia)
  skipped: number; // linhas ignoradas (sem IMEI)
  total: number; // linhas de dados lidas
};

// Normaliza cabeçalho: remove acentos, espaços extras e caixa alta, pra casar variações.
function normalizeHeader(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Mapa de cabeçalho da planilha -> campo do model. Aceita variações comuns.
const HEADER_MAP: Record<string, keyof ParsedRow> = {
  ICCID: 'iccid',
  LINHA: 'line',
  TELEFONE: 'line',
  NUMERO: 'line',
  MSISDN: 'line',
  IMEI: 'imei',
  OPERADORA: 'operator',
  STATUS: 'status',
  DATA: 'registeredAt',
  'DATA DE ATIVACAO': 'activatedAt',
  'DATA ATIVACAO': 'activatedAt',
  ATIVACAO: 'activatedAt',
  SERVER: 'server',
  SERVIDOR: 'server',
};

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(HINOVA_CLIENT) private hinova: IHinovaClient,
    private traccar: TraccarService,
    private deviceRegistry: DeviceRegistryService,
    private deviceHealth: DeviceHealthService,
    private stockTraccar: StockTraccarService,
    private installationPendings: InstallationPendingsService,
    private mirror: SgaMirrorService,
    private routes: RoutesService,
    private positions: PositionsService,
  ) {}

  /**
   * Conferência de instalação ao vivo de um item do estoque.
   *
   * Garante o device no Traccar antes de perguntar: rastreador que nunca foi
   * cadastrado lá tem tudo o que manda descartado, e a tela mostraria "não
   * reportou" pra sempre.
   */
  async signal(
    id: string,
    tenantId: string,
    refLat?: number,
    refLng?: number,
  ): Promise<DeviceHealth> {
    const item = await this.prisma.stockItem.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, imei: true, traccarDeviceId: true },
    });
    if (!item) throw new NotFoundException('Item de estoque não encontrado');

    await this.stockTraccar.ensureDevice(item);

    return this.deviceHealth.diagnose(item.imei, {
      refLat,
      refLng,
      ensureDevice: true,
    });
  }

  /**
   * Carimba a conferência: quem aprovou (ou reprovou), quando e com que
   * telemetria. Não bloqueia nada — decisão do dono: o selo informa, o operador
   * decide. O retrato é o que dá defesa no dia em que o cliente disser que o
   * rastreador nunca funcionou.
   */
  async validate(
    id: string,
    tenantId: string,
    dto: ValidateStockDto,
    userId: string,
    userName: string,
  ) {
    const item = await this.prisma.stockItem.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, imei: true, traccarDeviceId: true },
    });
    if (!item) throw new NotFoundException('Item de estoque não encontrado');

    const health = await this.deviceHealth.diagnose(item.imei, {
      ensureDevice: true,
    });

    const atualizado = await this.prisma.stockItem.update({
      where: { id: item.id },
      data: {
        validatedAt: new Date(),
        validatedById: userId,
        validatedByName: userName,
        validationOk: dto.approved,
        validationNotes: dto.notes?.trim() || null,
        validationSnapshot: health as unknown as object,
      },
      select: {
        id: true,
        validatedAt: true,
        validatedByName: true,
        validationOk: true,
        validationNotes: true,
      },
    });

    this.logger.log(
      `Instalação ${dto.approved ? 'APROVADA' : 'REPROVADA'}: IMEI ${item.imei} por ${userName}` +
        (health.motivos.length ? ` — ${health.motivos.join('; ')}` : ''),
    );

    return { ...atualizado, health };
  }

  /** Conectividade do estoque: cards e pontinho por linha. */
  connectivity(tenantId: string) {
    return this.stockTraccar.connectivity(tenantId);
  }

  /** Estoque no mapa: última posição conhecida + telemetria de cada rastreador. */
  map(tenantId: string) {
    return this.stockTraccar.mapPoints(tenantId);
  }

  async findAll(tenantId: string, filters: FilterStockDto) {
    const { page, perPage, search, status, operator, assignment, conexao } =
      filters;
    // associatedAt: null → só rastreadores disponíveis (associados saíram do estoque).
    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      associatedAt: null,
    };

    // Filtro por estado no servidor GPS. Precisa entrar no `where` (e não sair
    // filtrando no navegador) porque a lista é paginada: com 1.000 itens, os
    // online estão espalhados por todas as páginas.
    if (conexao) {
      let vivos: { comunicando: string[]; semGps: string[] };
      try {
        vivos = await this.stockTraccar.imeisComunicando();
      } catch {
        // Servidor GPS fora: não dá pra dizer quem está online. Devolver a
        // lista inteira fingindo que o filtro valeu seria mentira.
        return {
          data: [],
          meta: { total: 0, page, perPage, gpsIndisponivel: true },
        };
      }

      if (conexao === 'online') where.imei = { in: vivos.comunicando };
      else if (conexao === 'offline') where.imei = { notIn: vivos.comunicando };
      else where.imei = { in: vivos.semGps };
    }

    if (status) where.status = { equals: status, mode: 'insensitive' };
    if (operator) where.operator = { equals: operator, mode: 'insensitive' };
    if (assignment === 'free') where.assignedTechnicianId = null;
    if (assignment === 'assigned') where.assignedTechnicianId = { not: null };
    if (search) {
      where.OR = [
        { imei: { contains: search, mode: 'insensitive' } },
        { iccid: { contains: search, mode: 'insensitive' } },
        { line: { contains: search, mode: 'insensitive' } },
        { operator: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.stockItem.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        // Desempate obrigatório: o estoque entra em lote e centenas de itens
        // dividem o mesmo createdAt — só por ele, o Postgres devolve ordem
        // diferente a cada página e itens somem/repetem ao paginar.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        include: {
          assignedTechnician: { select: { id: true, name: true } },
        },
      }),
      this.prisma.stockItem.count({ where }),
    ]);

    return { data, meta: { total, page, perPage, gpsIndisponivel: false } };
  }

  /**
   * Cards da tela de estoque. Contam SÓ o que está disponível (associatedAt
   * null), igual à listagem — antes o total incluía os já instalados e não
   * fechava com a lista logo abaixo. `installed` vai separado, pra quem quiser
   * o número cheio. Ver P2.5 do plano.
   */
  async stats(tenantId: string) {
    const disponivel = { tenantId, deletedAt: null, associatedAt: null };
    const [total, installed, byStatusRaw] = await Promise.all([
      this.prisma.stockItem.count({ where: disponivel }),
      this.prisma.stockItem.count({
        where: { tenantId, deletedAt: null, associatedAt: { not: null } },
      }),
      this.prisma.stockItem.groupBy({
        by: ['status'],
        where: disponivel,
        _count: { _all: true },
      }),
    ]);
    const byStatus = byStatusRaw.map(
      (r: { status: string | null; _count: { _all: number } }) => ({
        status: r.status ?? 'SEM STATUS',
        count: r._count._all,
      }),
    );
    return { total, installed, byStatus };
  }

  async remove(id: string, tenantId: string) {
    const item = await this.prisma.stockItem.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Item de estoque não encontrado');
    await this.prisma.stockItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { id };
  }

  /**
   * Associar cliente e ativo: vincula um rastreador do estoque a uma placa do
   * SGA, criando cliente (Associate) + veículo (Vehicle) + rastreador (Device),
   * e tirando o item do estoque disponível. O IMEI é a identidade única.
   *
   * Regras (decididas com o usuário):
   * - Placa não encontrada no SGA → bloqueia (422).
   * - Placa INATIVA no SGA → bloqueia (422), salvo liberação de administrador
   *   (`allowInactive` + `liberadorAdmin`); operador e técnico nunca liberam.
   * - Técnico e local de instalação obrigatórios (validados no DTO).
   */
  /**
   * Consulta do vínculo. Três fontes, nesta ordem:
   *
   * 1. SGA ao vivo — é o dado mais fresco e o único que sabe de mensalidade
   *    vencida, mas só responde veículo que já tem boleto emitido.
   * 2. Espelho cadastral (SgaVehicle) — todo veículo do SGA, em qualquer
   *    situação. É quem cobre o veículo recém-vendido, que é justamente o que
   *    está indo receber rastreador.
   * 3. Espelho da fila de pendências — histórico, cobre a janela em que o
   *    cadastral ainda não sincronizou.
   *
   * Um só caminho pro painel, pro PWA do técnico e pro associate — senão o
   * botão habilita numa tela e o servidor recusa na outra.
   */
  async lookupSga(
    tenantId: string,
    placaOuChassi: string,
  ): Promise<HinovaLookupResult> {
    const vivo = await this.hinova.lookupByPlate(placaOuChassi);
    if (vivo.encontrado) {
      return {
        ...vivo,
        fonte: 'sga',
        boletoVencido: vivo.situacao.financeira === 'INADIMPLENTE',
      };
    }

    const cadastro = await this.mirror.lookup(tenantId, placaOuChassi);
    if (cadastro) {
      this.logger.log(
        `Lookup ${placaOuChassi}: SGA ao vivo disse "${vivo.motivo}"; respondendo pelo espelho cadastral (${cadastro.situacao.descricao}).`,
      );
      return cadastro;
    }

    const espelho = await this.installationPendings.lookupNoEspelho(
      tenantId,
      placaOuChassi,
    );
    if (espelho) {
      this.logger.log(
        `Lookup ${placaOuChassi}: SGA ao vivo disse "${vivo.motivo}"; respondendo pelo espelho de pendências.`,
      );
      return espelho;
    }

    return { ...vivo, motivo: StockService.motivoAmigavel(vivo.motivo, placaOuChassi) };
  }

  /**
   * O 406 de boleto é linguagem interna da API financeira do SGA e não diz nada
   * a quem está com o rastreador na mão. Erro de indisponibilidade (SGA fora,
   * restrição de horário) passa direto — ali a mensagem original é o diagnóstico.
   */
  private static motivoAmigavel(
    motivo: string | undefined,
    placa: string,
  ): string {
    const original = motivo ?? '';
    const ehFaltaDeBoleto = /boleto/i.test(original);
    const ehNaoEncontrado = /não encontrad|nao encontrad/i.test(original);
    if (!ehFaltaDeBoleto && !ehNaoEncontrado && original) return original;

    return (
      `Não localizei ${placa.toUpperCase()} no SGA. Confira a placa ou o chassi; ` +
      'se o cadastro é novo, atualize o espelho do SGA em Pendências de Instalação.'
    );
  }

  /**
   * Único juiz do "pode instalar". A decisão é pela SITUAÇÃO do cliente no
   * cadastro — nunca pela existência de boleto:
   *
   * - ATIVO e em dia            → instala, sem perguntar nada;
   * - mensalidade vencida       → avisa e só passa com liberação de admin;
   * - inativo/pendente/negado   → mesma coisa.
   */
  private static motivoDeBloqueio(
    lookup: HinovaLookupResult,
    placaDigitada: string,
  ): string | null {
    const placa = lookup.veiculo.placa || placaDigitada.toUpperCase();
    if (!lookup.ativo) {
      const situacao = lookup.situacao.descricao ?? 'INATIVA';
      return `Placa ${placa} está ${situacao} no SGA`;
    }
    if (lookup.boletoVencido) {
      const vencimento = lookup.situacao.dataVencimento
        ? ` (vencimento ${lookup.situacao.dataVencimento})`
        : '';
      return `Cliente da placa ${placa} está com mensalidade vencida no SGA${vencimento}`;
    }
    return null;
  }

  async associate(
    id: string,
    tenantId: string,
    dto: AssociateStockDto,
    /**
     * Quem chamou tem poder de liberar associado inativo. Só o controller do
     * painel passa true (e só para ADMIN/SUPER_ADMIN); o PWA do técnico chama
     * sem este argumento, então nunca libera.
     */
    liberadorAdmin = false,
  ) {
    const item = await this.prisma.stockItem.findFirst({
      where: { id, tenantId, deletedAt: null, associatedAt: null },
    });
    if (!item) {
      throw new NotFoundException(
        'Item de estoque não encontrado ou já associado.',
      );
    }

    // Fonte da verdade: o servidor rebusca no SGA (não confia no que veio da tela).
    const lookup = await this.lookupSga(tenantId, dto.placa);
    if (!lookup.encontrado) {
      throw new UnprocessableEntityException(
        lookup.motivo || 'Placa não encontrada no SGA.',
      );
    }
    const bloqueio = StockService.motivoDeBloqueio(lookup, dto.placa);
    if (bloqueio) {
      if (!dto.allowInactive) {
        throw new UnprocessableEntityException(
          `${bloqueio} — vínculo bloqueado. ` +
            'Só um administrador pode liberar a instalação assim mesmo.',
        );
      }
      if (!liberadorAdmin) {
        throw new ForbiddenException(
          `${bloqueio}. Somente um administrador pode liberar a instalação assim mesmo.`,
        );
      }
      this.logger.warn(
        `Vínculo liberado por ADMIN: ${bloqueio}. IMEI ${item.imei}, técnico ${dto.technicianName}.`,
      );
    }
    if (!lookup.cliente.cpf) {
      throw new UnprocessableEntityException(
        'SGA não retornou o CPF do cliente para esta placa.',
      );
    }

    // `Vehicle.uniqueId` e `Device.imei` são únicos GLOBAIS (não por tenant).
    // Um IMEI já em uso noutra empresa precisa parar aqui com mensagem clara —
    // sem isto, o fluxo ou estouraria 500 por constraint ou (pior) sequestraria
    // o registro alheio. Ver P1.1 do plano.
    await this.assertImeiLivreNoTenant(item.imei, tenantId);

    // Moto nova sem placa: o SGA devolve placa vazia e o técnico vincula pelo
    // chassi — que vira a "placa" do ativo até o emplacamento.
    const placa = (lookup.veiculo.placa || dto.placa)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    // Sempre só dígitos: o CPF é o login (e a senha) do associado no app.
    const cpf = lookup.cliente.cpf.replace(/\D/g, '');
    const technicianName = dto.technicianName.trim();
    const installLocation = dto.installLocation.trim();

    // Contato do cliente: o lookup por placa do SGA não devolve telefone/e-mail,
    // mas o espelho de pendências (que vem de /listar/veiculo) devolve — e cobre
    // 99% da base. Sem isto o cliente fica sem canal e não consegue recuperar a
    // senha do app sozinho.
    const contato = await this.contatoDaPendencia(tenantId, placa, cpf);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1) Cliente — dedupe por (tenant, cpf).
      let associate = await tx.associate.findFirst({
        where: { tenantId, cpf, deletedAt: null },
      });
      if (associate) {
        associate = await tx.associate.update({
          where: { id: associate.id },
          data: {
            name: lookup.cliente.nome ?? associate.name,
            hinovaCode: lookup.veiculo.codigoVeiculo ?? associate.hinovaCode,
            // Nunca apaga contato já existente: só preenche o que falta.
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

      // 2) Veículo — dedupe por (placa, tenant) OU (uniqueId, tenant).
      // O `tenantId` no braço do uniqueId é obrigatório: sem ele, um IMEI já
      // usado em OUTRA empresa faria este update reatribuir placa e cliente do
      // veículo alheio. Ver P1.1 do plano.
      let vehicle = await tx.vehicle.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          OR: [{ plate: placa }, { uniqueId: item.imei }],
        },
      });
      // A situação no SGA sai de graça aqui: o lookup por placa já foi feito
      // pra validar o vínculo. Sem isto, o ativo nasceria sem situação e só
      // ganharia uma no próximo cron.
      const situacaoSga = {
        financialStatus: normalizeFinancialStatus(lookup.situacao.financeira),
        financialStatusAt: new Date(),
        sgaStatusLabel: normalizeSgaStatusLabel(lookup.situacao.descricao),
      };

      if (vehicle) {
        vehicle = await tx.vehicle.update({
          where: { id: vehicle.id },
          data: {
            plate: placa,
            // `unique_id` acompanha o rastreador que está no carro agora. Sem
            // isto, um veículo que já existia (criado pelo sync do SGA com
            // `HINOVA-<codigo>`, ou que teve o aparelho trocado) ficaria pra
            // sempre com o número de outro equipamento — e a busca por IMEI
            // na tela de veículos não acharia o carro.
            uniqueId: item.imei,
            chassi: lookup.veiculo.chassi ?? vehicle.chassi,
            model: lookup.veiculo.modelo ?? vehicle.model,
            status: 'ACTIVE',
            associateId: associate.id,
            hinovaCode: lookup.veiculo.codigoVeiculo ?? vehicle.hinovaCode,
            lastSync: new Date(),
            ...situacaoSga,
          },
        });
      } else {
        vehicle = await tx.vehicle.create({
          data: {
            plate: placa,
            uniqueId: item.imei,
            chassi: lookup.veiculo.chassi,
            model: lookup.veiculo.modelo,
            status: 'ACTIVE',
            tenantId,
            associateId: associate.id,
            hinovaCode: lookup.veiculo.codigoVeiculo,
            lastSync: new Date(),
            ...situacaoSga,
          },
        });
      }

      // 3) Rastreador — um Device por IMEI e por veículo. O filtro por tenant
      // é redundante depois do assertImeiLivreNoTenant, mas mantém a garantia
      // local: nada aqui dentro toca registro de outra empresa.
      //
      // `devices.vehicle_id` é UNIQUE: se a placa já tem OUTRO rastreador, o
      // create abaixo estoura a constraint e o técnico leva um 500 sem
      // explicação. Aqui ele recebe o IMEI que está instalado e sabe o que
      // fazer — retirar o atual antes de instalar o novo.
      const jaInstalado = await tx.device.findFirst({
        where: { vehicleId: vehicle.id },
        select: { id: true, imei: true },
      });
      if (jaInstalado && jaInstalado.imei !== item.imei) {
        throw new UnprocessableEntityException(
          `A placa ${placa} já está com o rastreador IMEI ${jaInstalado.imei} ` +
            'instalado. Retire o rastreador atual antes de instalar outro.',
        );
      }

      const existingDevice = await tx.device.findFirst({
        where: { imei: item.imei, tenantId },
      });

      // Espelho da checagem de placa ocupada: o aparelho só pode entrar num
      // veículo novo se não estiver preso a outro. Sem isto, o `update` abaixo
      // arrancaria o rastreador do carro alheio em silêncio — o dono antigo
      // sumiria do mapa sem ninguém saber por quê.
      if (existingDevice?.vehicleId && existingDevice.vehicleId !== vehicle.id) {
        const ocupado = await tx.vehicle.findFirst({
          where: { id: existingDevice.vehicleId },
          select: { plate: true },
        });
        throw new UnprocessableEntityException(
          `O rastreador IMEI ${item.imei} ainda está instalado ` +
            `${ocupado?.plate ? `na placa ${ocupado.plate}` : 'em outro veículo'}. ` +
            'Desvincule o rastreador antes de instalar em outro veículo.',
        );
      }

      const device = existingDevice
        ? await tx.device.update({
            where: { id: existingDevice.id },
            data: {
              vehicleId: vehicle.id,
              status: 'INSTALLED',
              installedAt: new Date(),
              installedBy: technicianName,
              installedByTechnicianId: dto.technicianId ?? null,
              installLocation,
              // Aparelho reinstalado não pode carregar a data e o motivo da
              // retirada anterior — o cadastro diria "retirado" com o
              // equipamento em campo.
              uninstalledAt: null,
              uninstalledBy: null,
              uninstallReason: null,
            },
          })
        : await tx.device.create({
            data: {
              imei: item.imei,
              model: 'OTHER',
              status: 'INSTALLED',
              vehicleId: vehicle.id,
              tenantId,
              installedAt: new Date(),
              installedBy: technicianName,
              installedByTechnicianId: dto.technicianId ?? null,
              installLocation,
            },
          });

      // 4) Item sai do estoque disponível e da lista do técnico.
      await tx.stockItem.update({
        where: { id: item.id },
        data: {
          associatedAt: new Date(),
          deviceId: device.id,
          assignedTechnicianId: null,
          assignedAt: null,
        },
      });

      return { associate, vehicle, device };
    });

    // 5) Traccar (best-effort — não derruba o vínculo se estiver indisponível).
    let traccarDeviceId: number | null = null;
    let traccarLastUpdate: string | null = null;
    try {
      let traccarDevice = await this.traccar.getDeviceByUniqueId(item.imei);
      if (!traccarDevice) {
        traccarDevice = await this.traccar.createDevice(placa, item.imei);
      } else if (traccarDevice.name !== placa) {
        // O estoque agora entra no Traccar com o IMEI como nome. Sem renomear
        // aqui, o veículo instalado apareceria no mapa chamado "8665570846...".
        try {
          await this.traccar.updateDevice(traccarDevice.id, {
            ...traccarDevice,
            name: placa,
          });
        } catch (error) {
          this.logger.warn(
            `Não consegui renomear o device ${item.imei} pra placa ${placa} no Traccar: ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
      }
      if (traccarDevice?.id) {
        traccarDeviceId = traccarDevice.id;
        traccarLastUpdate = traccarDevice.lastUpdate ?? null;
        await this.prisma.$transaction([
          this.prisma.vehicle.update({
            where: { id: result.vehicle.id },
            data: { traccarDeviceId: traccarDevice.id },
          }),
          this.prisma.device.update({
            where: { id: result.device.id },
            data: { traccarDeviceId: traccarDevice.id },
          }),
        ]);
      }
    } catch (error) {
      this.logger.warn(
        `Associação ${item.imei}: Traccar indisponível (${
          error instanceof Error ? error.message : error
        }). Device vinculado sem traccarDeviceId.`,
      );
    }

    // 5b) Primeira posição na hora. O histórico do painel só nasce a partir do
    // vínculo, e um carro parado pode levar horas até o próximo fix — até lá o
    // card do cliente dizia "Nunca comunicou" e o app abria vazio, mesmo com o
    // rastreador reportando há dias. Copia a última posição já conhecida do
    // Traccar, pelo mesmo juiz de qualidade de sempre (persistIfRelevant).
    if (traccarDeviceId) {
      try {
        const [ultima] = await this.traccar.getPositions(traccarDeviceId);
        if (ultima) {
          await this.positions.persistIfRelevant(
            ultima,
            result.vehicle.id,
            tenantId,
          );
        }
        if (traccarLastUpdate) {
          await this.prisma.device.update({
            where: { id: result.device.id },
            data: { lastConnection: new Date(traccarLastUpdate) },
          });
        }
      } catch (error) {
        this.logger.warn(
          `Associação ${item.imei}: não consegui copiar a última posição do Traccar (${
            error instanceof Error ? error.message : error
          }).`,
        );
      }
    }

    // 6) A placa deixa de ser pendência no mesmo instante. Sem isso ela ficaria
    // na fila até o próximo sync do SGA — a lista tem que mostrar só quem falta.
    // E a parada correspondente sai da rota do técnico (marcada como concluída).
    //
    // Tudo daqui pra baixo é best-effort: a instalação JÁ foi commitada, então
    // nenhuma falha acessória pode virar erro pro técnico (ele tentaria de novo
    // e receberia "item já associado", que confunde). Ver P1.6 do plano.
    await this.installationPendings.removeByPlate(tenantId, placa);
    try {
      await this.routes.markStopDoneByPlate(tenantId, placa);
    } catch (error) {
      this.logger.warn(
        `Não consegui baixar a parada de rota da placa ${placa}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }

    // 7) Mapping do tempo real na hora: sem isto o carro recém-instalado ficava
    // até 2 minutos sem aparecer no mapa (o gateway descartava as posições dele
    // por não conhecer o device ainda). Ver P0.3 do plano.
    this.deviceRegistry.notifyDeviceChanged(`instalação da placa ${placa}`);

    this.logger.log(
      `Estoque associado: IMEI ${item.imei} → placa ${placa} (cliente ${result.associate.id})`,
    );

    return {
      ok: true,
      associateId: result.associate.id,
      vehicleId: result.vehicle.id,
      deviceId: result.device.id,
      placa,
    };
  }

  /**
   * Telefone e e-mail do cliente, lidos do espelho de pendências do SGA.
   *
   * Busca pela placa e, se não achar (placa nova, pendência já removida), pelo
   * CPF — o mesmo associado costuma ter outros veículos na fila. Best-effort:
   * sem contato o cadastro segue, só que o cliente vai depender do atendimento
   * pra recuperar a senha.
   */
  private async contatoDaPendencia(
    tenantId: string,
    placa: string,
    cpf: string,
  ): Promise<{ phone: string | null; email: string | null }> {
    try {
      const pendencia =
        (await this.prisma.installationPending.findFirst({
          where: { tenantId, plate: placa },
          select: { phone: true, email: true },
        })) ??
        (await this.prisma.installationPending.findFirst({
          where: { tenantId, cpf: { contains: cpf } },
          select: { phone: true, email: true },
          orderBy: { syncedAt: 'desc' },
        }));

      if (pendencia?.phone?.trim() || pendencia?.email?.trim()) {
        return {
          phone: pendencia.phone?.trim() || null,
          email: pendencia.email?.trim() || null,
        };
      }

      // Fila de pendências não cobre veículo que nunca esteve nela (adesão já
      // marcada como instalada no SGA, por exemplo). O espelho cadastral cobre.
      const cadastro = await this.mirror.contato(tenantId, placa, cpf);
      return {
        phone: cadastro?.phone?.trim() || null,
        email: cadastro?.email?.trim() || null,
      };
    } catch (error) {
      this.logger.warn(
        `Não consegui recuperar o contato da placa ${placa}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return { phone: null, email: null };
    }
  }

  /**
   * Barra IMEI que já pertence a outra empresa.
   *
   * `Vehicle.uniqueId` e `Device.imei` são únicos no banco inteiro, não por
   * tenant. Sem esta checagem, associar um IMEI já usado noutra empresa ou
   * estouraria a constraint (500 sem explicação) ou reatribuiria o veículo
   * alheio — vazamento entre empresas. Ver P1.1 do plano.
   */
  private async assertImeiLivreNoTenant(imei: string, tenantId: string) {
    const [veiculoAlheio, deviceAlheio] = await Promise.all([
      this.prisma.vehicle.findFirst({
        where: { uniqueId: imei, tenantId: { not: tenantId } },
        select: { id: true },
      }),
      this.prisma.device.findFirst({
        where: { imei, tenantId: { not: tenantId } },
        select: { id: true },
      }),
    ]);

    if (veiculoAlheio || deviceAlheio) {
      this.logger.warn(
        `Tentativa de associar IMEI ${imei} que já pertence a outra empresa (tenant ${tenantId}).`,
      );
      throw new UnprocessableEntityException(
        'Este rastreador já está cadastrado em outra empresa. Fale com o suporte.',
      );
    }
  }

  /**
   * Reserva equipamentos pro login do técnico, em lote. Um item já reservado por
   * outro técnico não aborta o lote — volta em `skipped` com o motivo, pra tela
   * mostrar exatamente o que não foi.
   */
  async assign(tenantId: string, dto: AssignStockDto, userId: string) {
    const { stockItemIds, technicianId } = dto;
    if (!technicianId) {
      throw new BadRequestException('Informe o técnico que vai receber.');
    }

    const technician = await this.prisma.technician.findFirst({
      where: { id: technicianId, tenantId, deletedAt: null },
      select: { id: true, name: true, active: true, canReceiveEquipment: true },
    });
    if (!technician) throw new NotFoundException('Técnico não encontrado');
    if (!technician.active) {
      throw new UnprocessableEntityException(
        `${technician.name} está inativo.`,
      );
    }
    if (!technician.canReceiveEquipment) {
      throw new UnprocessableEntityException(
        `${technician.name} não está habilitado a receber equipamentos.`,
      );
    }

    const items = await this.prisma.stockItem.findMany({
      where: { id: { in: stockItemIds }, tenantId, deletedAt: null },
      select: {
        id: true,
        imei: true,
        associatedAt: true,
        assignedTechnicianId: true,
        assignedTechnician: { select: { name: true } },
      },
    });

    const skipped: Array<{ imei: string; motivo: string }> = [];
    const okIds: string[] = [];

    for (const item of items) {
      if (item.associatedAt) {
        skipped.push({ imei: item.imei, motivo: 'já instalado' });
      } else if (
        item.assignedTechnicianId &&
        item.assignedTechnicianId !== technicianId
      ) {
        skipped.push({
          imei: item.imei,
          motivo: `já está com ${item.assignedTechnician?.name ?? 'outro técnico'}`,
        });
      } else {
        okIds.push(item.id);
      }
    }

    const encontrados = new Set(items.map((i) => i.id));
    for (const id of stockItemIds) {
      if (!encontrados.has(id)) {
        skipped.push({ imei: id, motivo: 'não encontrado no estoque' });
      }
    }

    if (okIds.length > 0) {
      await this.prisma.stockItem.updateMany({
        where: { id: { in: okIds }, tenantId },
        data: {
          assignedTechnicianId: technicianId,
          assignedAt: new Date(),
          assignedById: userId,
        },
      });
    }

    this.logger.log(
      `Reserva: ${okIds.length} equipamento(s) pro técnico ${technician.name} (${skipped.length} ignorados)`,
    );
    return { ok: okIds.length, skipped };
  }

  /** Devolve equipamentos ao estoque livre (cancela a reserva). */
  async unassign(tenantId: string, stockItemIds: string[]) {
    const result = await this.prisma.stockItem.updateMany({
      where: {
        id: { in: stockItemIds },
        tenantId,
        deletedAt: null,
        associatedAt: null,
      },
      data: {
        assignedTechnicianId: null,
        assignedAt: null,
        assignedById: null,
      },
    });
    return {
      ok: result.count,
      skipped: [] as Array<{ imei: string; motivo: string }>,
    };
  }

  async importFromBuffer(
    buffer: Buffer,
    tenantId: string,
  ): Promise<ImportResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException(
        'Arquivo inválido. Envie uma planilha .xlsx válida.',
      );
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      throw new BadRequestException('Planilha vazia ou sem dados.');
    }

    // Mapeia índice da coluna -> campo, lendo a primeira linha como cabeçalho.
    const headerRow = worksheet.getRow(1);
    const colToField = new Map<number, keyof ParsedRow>();
    for (let c = 1; c <= worksheet.columnCount; c++) {
      const header = this.cellText(headerRow.getCell(c));
      if (!header) continue;
      const field = HEADER_MAP[normalizeHeader(header)];
      if (field) colToField.set(c, field);
    }

    if (!Array.from(colToField.values()).includes('imei')) {
      throw new BadRequestException(
        'A planilha precisa ter uma coluna "IMEI".',
      );
    }

    const rows: ParsedRow[] = [];
    let skipped = 0;
    for (let r = 2; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const parsed: ParsedRow = {
        imei: '',
        iccid: null,
        line: null,
        operator: null,
        status: null,
        server: null,
        registeredAt: null,
        activatedAt: null,
      };
      for (const [col, field] of colToField) {
        const cell = row.getCell(col);
        if (field === 'registeredAt' || field === 'activatedAt') {
          parsed[field] = this.cellDate(cell);
        } else {
          const value = this.cellText(cell) || null;
          parsed[field] = value as never;
        }
      }
      if (!parsed.imei) {
        skipped++;
        continue;
      }
      rows.push(parsed);
    }

    if (rows.length === 0) {
      throw new BadRequestException(
        'Nenhuma linha com IMEI encontrada na planilha.',
      );
    }

    // Classifica criados vs atualizados comparando com o que já existe no tenant.
    const imeis = rows.map((row) => row.imei);
    const existing = await this.prisma.stockItem.findMany({
      where: { tenantId, imei: { in: imeis } },
      select: { imei: true },
    });
    const existingSet = new Set(existing.map((e) => e.imei));

    let imported = 0;
    let updated = 0;

    // Upsert por (tenantId, imei) em lotes pra não estourar o pool de conexões.
    const batchSize = 25;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await Promise.all(
        batch.map((row) =>
          this.prisma.stockItem.upsert({
            where: { tenantId_imei: { tenantId, imei: row.imei } },
            create: {
              tenantId,
              imei: row.imei,
              iccid: row.iccid,
              line: row.line,
              operator: row.operator,
              status: row.status,
              server: row.server,
              registeredAt: row.registeredAt,
              activatedAt: row.activatedAt,
            },
            update: {
              iccid: row.iccid,
              line: row.line,
              operator: row.operator,
              status: row.status,
              server: row.server,
              registeredAt: row.registeredAt,
              activatedAt: row.activatedAt,
              deletedAt: null, // reimportar restaura item removido
            },
          }),
        ),
      );
      for (const row of batch) {
        if (existingSet.has(row.imei)) updated++;
        else imported++;
      }
    }

    this.logger.log(
      `Import estoque tenant=${tenantId}: ${imported} novos, ${updated} atualizados, ${skipped} ignorados`,
    );

    // Cadastra o que entrou no servidor GPS, em segundo plano: sem device no
    // Traccar não há como conferir instalação antes de vincular. Falha aqui não
    // pode derrubar a importação — o cron de 30 min pega o que sobrar.
    void this.stockTraccar.ensurePending(tenantId).catch((erro) => {
      this.logger.warn(
        `Cadastro do estoque importado no Traccar falhou: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
    });

    return { imported, updated, skipped, total: rows.length };
  }

  // --- helpers de leitura de célula (exceljs retorna tipos variados) ---

  private cellText(cell: ExcelJS.Cell): string {
    const value = cell?.value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim();
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const v = value as unknown as Record<string, unknown>;
      if ('text' in v && v.text != null) return String(v.text).trim();
      if ('result' in v && v.result != null) return String(v.result).trim();
      if ('richText' in v && Array.isArray(v.richText)) {
        return (v.richText as Array<{ text: string }>)
          .map((t) => t.text)
          .join('')
          .trim();
      }
    }
    return String(value).trim();
  }

  private cellDate(cell: ExcelJS.Cell): Date | null {
    const value = cell?.value;
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object' && value && 'result' in value) {
      const r = (value as { result: unknown }).result;
      if (r instanceof Date) return r;
    }
    const text = this.cellText(cell);
    if (!text) return null;
    const parsed = new Date(text);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
}
