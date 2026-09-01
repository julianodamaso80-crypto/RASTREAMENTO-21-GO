import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  HINOVA_CLIENT,
  SITUACOES_SGA,
  type HinovaLookupResult,
  type HinovaRawVehicle,
  type IHinovaClient,
} from '../hinova/hinova.interface';
import { tipoVeiculoDoSga } from '../hinova/tipo-veiculo';

/**
 * Espelho cadastral do SGA — todo veículo, em qualquer situação.
 *
 * Por que existe: o SGA não oferece busca por placa. O único GET que aceita
 * placa é o /buscar/situacao-financeira-veiculo, que é FINANCEIRO e responde
 * 406 "Não foram encontrados boletos" enquanto o veículo não tem boleto
 * emitido — justamente o veículo recém-vendido que está indo receber
 * rastreador. Amarrar a instalação a esse endpoint faz "não tem boleto" virar
 * "não pode instalar", que não é regra de negócio nenhuma.
 *
 * Com o espelho, quem decide é a SITUAÇÃO do veículo no cadastro:
 * ativo instala; inadimplente, inativo, pendente ou negado avisa o motivo e só
 * passa com liberação de administrador.
 *
 * A fonte é o POST /listar/veiculo, que já é varrido pelo sync de pendências e
 * hoje tem 70% do resultado descartado.
 */
@Injectable()
export class SgaMirrorService implements OnModuleInit {
  private readonly logger = new Logger(SgaMirrorService.name);

  /** Trava contra varredura dupla: o sync de pendências também chama sincronizar(). */
  private sincronizando = false;

  /** Mesmo lote e pausa do sync de pendências — o SGA responde 406 sob rajada. */
  private static readonly LOTE = 1000;
  private static readonly MAX_PAGINAS = 50;
  private static readonly PAUSA_ENTRE_PAGINAS_MS = 2500;

  /** Todas as situações conhecidas do SGA (ver SITUACOES_SGA). */
  private static readonly SITUACOES = [1, 2, 3, 4, 5];

  constructor(
    @Inject(HINOVA_CLIENT) private hinova: IHinovaClient,
    private prisma: PrismaService,
  ) {}

  /**
   * Carga própria, sem depender do sync de pendências.
   *
   * O sync de pendências só chega no espelho depois de ~10 minutos de varredura,
   * e é o espelho que sustenta a instalação em campo — ele não pode ficar refém
   * do que vem antes. Roda uma vez, só com a tabela vazia.
   */
  onModuleInit(): void {
    setTimeout(() => {
      void this.cargaInicial();
    }, 20_000).unref();
  }

  private async cargaInicial(): Promise<void> {
    try {
      const jaTem = await this.prisma.sgaVehicle.count();
      if (jaTem > 0) return;

      const tenant = await this.prisma.tenant.findFirst({
        where: { active: true, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      if (!tenant) return;

      this.logger.warn('Espelho cadastral vazio — disparando carga inicial.');
      await this.sincronizar(tenant.id);
    } catch (erro) {
      this.logger.error(
        `Carga inicial do espelho cadastral falhou: ${erro instanceof Error ? erro.message : erro}`,
      );
    }
  }

  /**
   * Consulta por placa OU chassi. É a fonte primária do vínculo do estoque:
   * responde sempre, com a situação cadastral, sem depender de boleto.
   */
  async lookup(
    tenantId: string,
    placaOuChassi: string,
  ): Promise<HinovaLookupResult | null> {
    const ident = (placaOuChassi || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (ident.length < 7) return null;

    const v = await this.prisma.sgaVehicle.findFirst({
      where: { tenantId, OR: [{ plate: ident }, { chassi: ident }] },
      orderBy: { syncedAt: 'desc' },
    });
    if (!v) return null;

    return {
      encontrado: true,
      ativo: v.situationCode === '1',
      boletoVencido: false,
      fonte: 'cadastro',
      cliente: { nome: v.associateName || null, cpf: v.cpf || null },
      veiculo: {
        placa: v.plate || null,
        chassi: v.chassi || null,
        codigoModelo: null,
        modelo: v.brandModel || null,
        codigoVeiculo: v.hinovaVehicleCode || null,
        tipo: v.vehicleType,
      },
      situacao: {
        codigo: v.situationCode,
        descricao: v.situationLabel,
        financeira: null,
        dataVencimento: null,
      },
    };
  }

  /**
   * Rótulo de tipo do SGA ("MOTOCICLETA (ATé 400CC)", "VEICULOS LEVES"…).
   *
   * Existe porque o lookup financeiro ao vivo — o caminho normal de quem já tem
   * boleto — não devolve o tipo. Sem completar por aqui, toda moto instalada
   * nascia como carro no mapa: TUG1G87, TTW6E05 e TUM4I83 (CG 160 e YBR 150)
   * entraram assim em 01/09/2026, horas depois de o parque ter sido alinhado.
   */
  async tipoCru(
    tenantId: string,
    ...identificadores: Array<string | null | undefined>
  ): Promise<string | null> {
    const idents = identificadores
      .map((i) => (i ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter((i) => i.length >= 7);
    if (idents.length === 0) return null;

    const v = await this.prisma.sgaVehicle.findFirst({
      where: {
        tenantId,
        vehicleType: { not: null },
        OR: [{ plate: { in: idents } }, { chassi: { in: idents } }],
      },
      orderBy: { syncedAt: 'desc' },
      select: { vehicleType: true },
    });
    return v?.vehicleType ?? null;
  }

  /** Telefone/e-mail do associado — o lookup ao vivo do SGA não devolve nenhum dos dois. */
  async contato(
    tenantId: string,
    placa: string,
    cpf: string,
  ): Promise<{ phone: string | null; email: string | null } | null> {
    const v = await this.prisma.sgaVehicle.findFirst({
      where: {
        tenantId,
        OR: [{ plate: placa }, { chassi: placa }, { cpf }],
      },
      orderBy: { syncedAt: 'desc' },
      select: { phone: true, email: true },
    });
    return v ?? null;
  }

  /**
   * Varre o SGA situação por situação e reescreve o espelho.
   *
   * Grava página a página em vez de acumular a base inteira em memória: são
   * ~36 mil veículos, e o backend já morre de OOM com folga curta.
   */
  async sincronizar(
    tenantId: string,
    /**
     * Veículos ATIVOS que o sync de pendências acabou de ler. Reaproveitar a
     * lista evita varrer os 24 mil ativos duas vezes na mesma passada — a
     * varredura é o gargalo (minutos), não a gravação.
     */
    ativosJaLidos?: HinovaRawVehicle[],
  ): Promise<{
    total: number;
    porSituacao: Record<string, number>;
  }> {
    if (this.sincronizando) {
      this.logger.warn(
        'Espelho cadastral já está sincronizando — chamada ignorada.',
      );
      return { total: 0, porSituacao: {} };
    }
    this.sincronizando = true;
    const inicio = new Date();
    const porSituacao: Record<string, number> = {};
    let total = 0;

    try {
      if (ativosJaLidos?.length) {
        let gravados = 0;
        for (let i = 0; i < ativosJaLidos.length; i += SgaMirrorService.LOTE) {
          gravados += await this.gravarPagina(
            ativosJaLidos.slice(i, i + SgaMirrorService.LOTE),
            tenantId,
            1,
          );
        }
        porSituacao.ATIVO = gravados;
        total += gravados;
        this.logger.log(
          `Espelho cadastral: ${gravados} ativo(s) reaproveitados da varredura de pendências.`,
        );
      }

      for (const situacao of SgaMirrorService.SITUACOES) {
        if (situacao === 1 && ativosJaLidos?.length) continue;
        let daSituacao = 0;
        for (let pagina = 0; pagina < SgaMirrorService.MAX_PAGINAS; pagina++) {
          const lote = await this.hinova.listRawVehiclesBySituation(
            situacao,
            pagina * SgaMirrorService.LOTE,
            SgaMirrorService.LOTE,
          );
          if (lote.length > 0) {
            daSituacao += await this.gravarPagina(lote, tenantId, situacao);
          }
          if (lote.length < SgaMirrorService.LOTE) break;
          await new Promise((r) =>
            setTimeout(r, SgaMirrorService.PAUSA_ENTRE_PAGINAS_MS),
          );
        }
        porSituacao[SITUACOES_SGA[String(situacao)] ?? String(situacao)] =
          daSituacao;
        total += daSituacao;
        this.logger.log(
          `Espelho cadastral: ${daSituacao} veículo(s) na situação ${situacao}.`,
        );
      }

      // Rede de segurança igual à do sync de pendências: SGA devolvendo quase nada
      // por falha silenciosa não pode esvaziar o espelho que a operação usa.
      const jaGravados = await this.prisma.sgaVehicle.count({
        where: { tenantId },
      });
      if (jaGravados > 0 && total < jaGravados * 0.3) {
        this.logger.error(
          `SGA devolveu ${total} veículo(s) contra ${jaGravados} já espelhados ` +
            '(queda acima de 70%). Espelho preservado — verifique o SGA.',
        );
        return { total, porSituacao };
      }

      // Só aqui some quem saiu do SGA: as páginas já regravaram todo o resto com
      // syncedAt novo.
      const { count } = await this.prisma.sgaVehicle.deleteMany({
        where: { tenantId, syncedAt: { lt: inicio } },
      });
      if (count > 0) {
        this.logger.log(
          `Espelho cadastral: ${count} veículo(s) saíram do SGA.`,
        );
      }

      this.logger.warn(`Espelho cadastral sincronizado: ${total} veículo(s).`);
      await this.alinharTipoDosVeiculos(tenantId);
      return { total, porSituacao };
    } finally {
      this.sincronizando = false;
    }
  }

  /**
   * Alinha carro x moto dos veículos já cadastrados com o que o SGA diz.
   *
   * `Vehicle.vehicleType` nasce com o default `CAR` e só mudava se alguém
   * clicasse no botão da tela do veículo: em 01/09/2026 eram 401 de 403 como
   * carro, com CG 160 TITAN, PCX 160 e ADV 160 no meio — o mapa desenhava
   * carro em cima de moto e escrevia "Carro ligado". Aqui o espelho, que já
   * carrega o `tipo` do SGA, corrige o parque inteiro depois de cada sync.
   *
   * Só mexe em quem está divergente e só quando o SGA tem opinião: veículo
   * fora do espelho fica como está.
   */
  async alinharTipoDosVeiculos(tenantId: string): Promise<number> {
    const veiculos = await this.prisma.vehicle.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, plate: true, chassi: true, vehicleType: true },
    });
    if (veiculos.length === 0) return 0;

    const placas = veiculos.map((v) => v.plate).filter(Boolean);
    const chassis = veiculos
      .map((v) => v.chassi)
      .filter((c): c is string => !!c);

    const espelho = await this.prisma.sgaVehicle.findMany({
      where: {
        tenantId,
        vehicleType: { not: null },
        OR: [{ plate: { in: placas } }, { chassi: { in: chassis } }],
      },
      select: { plate: true, chassi: true, vehicleType: true },
    });

    const porPlaca = new Map<string, string>();
    const porChassi = new Map<string, string>();
    for (const e of espelho) {
      if (e.plate && e.vehicleType) porPlaca.set(e.plate, e.vehicleType);
      if (e.chassi && e.vehicleType) porChassi.set(e.chassi, e.vehicleType);
    }

    const virarMoto: string[] = [];
    const virarCarro: string[] = [];
    for (const v of veiculos) {
      const bruto =
        porPlaca.get(v.plate) ?? (v.chassi ? porChassi.get(v.chassi) : null);
      const tipo = tipoVeiculoDoSga(bruto);
      if (!tipo || tipo === v.vehicleType) continue;
      (tipo === 'MOTORCYCLE' ? virarMoto : virarCarro).push(v.id);
    }

    if (virarMoto.length === 0 && virarCarro.length === 0) return 0;

    if (virarMoto.length > 0) {
      await this.prisma.vehicle.updateMany({
        where: { id: { in: virarMoto } },
        data: { vehicleType: 'MOTORCYCLE' },
      });
    }
    if (virarCarro.length > 0) {
      await this.prisma.vehicle.updateMany({
        where: { id: { in: virarCarro } },
        data: { vehicleType: 'CAR' },
      });
    }

    const total = virarMoto.length + virarCarro.length;
    this.logger.warn(
      `Tipo do veículo alinhado com o SGA: ${virarMoto.length} moto(s) e ` +
        `${virarCarro.length} carro(s) corrigidos.`,
    );
    return total;
  }

  /**
   * Regrava uma página inteira. Apaga só os códigos da própria página e recria
   * — dois comandos por página em vez de um upsert por veículo (36 mil queries),
   * e a tela nunca vê o espelho vazio.
   */
  private async gravarPagina(
    lote: HinovaRawVehicle[],
    tenantId: string,
    situacao: number,
  ): Promise<number> {
    const linhas = lote
      .map((v) => SgaMirrorService.paraLinha(v, tenantId, situacao))
      .filter((l): l is NonNullable<typeof l> => l !== null);
    if (linhas.length === 0) return 0;

    const codigos = linhas.map((l) => l.hinovaVehicleCode);
    await this.prisma.$transaction([
      this.prisma.sgaVehicle.deleteMany({
        where: { tenantId, hinovaVehicleCode: { in: codigos } },
      }),
      this.prisma.sgaVehicle.createMany({ data: linhas }),
    ]);
    return linhas.length;
  }

  /** Veículo sem placa E sem chassi não serve pra nada aqui — não há como buscá-lo. */
  private static paraLinha(
    v: HinovaRawVehicle,
    tenantId: string,
    situacao: number,
  ) {
    const codigo = String(v.codigo_veiculo ?? '').trim();
    const plate = String(v.placa ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const chassi =
      String(v.chassi ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '') || null;
    if (!codigo || (!plate && !chassi)) return null;

    const codigoSituacao = String(v.codigo_situacao ?? situacao);
    const telefone = SgaMirrorService.telefone(v);

    return {
      hinovaVehicleCode: codigo,
      plate,
      chassi,
      associateName: String(v.nome_associado ?? '').trim(),
      associateCode: String(v.codigo_associado ?? '').trim(),
      cpf: String(v.cpf_associado ?? '').replace(/\D/g, '') || null,
      phone: telefone,
      email: String(v.email ?? '').trim() || null,
      brandModel: `${v.marca ?? ''} ${v.modelo ?? ''}`.trim(),
      situationCode: codigoSituacao,
      situationLabel:
        String(v.descricao_situacao ?? '').trim() ||
        SITUACOES_SGA[codigoSituacao] ||
        'DESCONHECIDA',
      adhesionCode: v.codigo_tipo_adesao ? String(v.codigo_tipo_adesao) : null,
      /// Rótulo cru do SGA ("MOTOCICLETA (ATé 400CC)", "VEICULOS LEVES"…). É a
      /// única fonte que sabe se o ativo é moto — o modelo sozinho não serve.
      vehicleType: String(v.tipo ?? '').trim() || null,
      contractDate: SgaMirrorService.data(v.data_contrato),
      tenantId,
      syncedAt: new Date(),
    };
  }

  /** Celular na frente do fixo: é o número que recebe o código do app por WhatsApp. */
  private static telefone(v: HinovaRawVehicle): string | null {
    const junta = (ddd: unknown, numero: unknown) => {
      const d = String(ddd ?? '').replace(/\D/g, '');
      const n = String(numero ?? '').replace(/\D/g, '');
      return n ? `${d}${n}` : '';
    };
    return (
      junta(v.ddd_celular, v.telefone_celular) ||
      junta(v.ddd, v.telefone) ||
      null
    );
  }

  /** "2026-05-04T00:00:00-0300" → Date; qualquer coisa fora disso vira null. */
  private static data(valor: unknown): Date | null {
    if (typeof valor !== 'string' || valor.length < 10) return null;
    const d = new Date(valor.slice(0, 10));
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
