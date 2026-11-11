import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';

/**
 * Mesma régua do Mapa: frontend/dashboard/src/lib/constants.ts:142-145 e
 * getDisplayStatus em frontend/dashboard/src/lib/utils.ts:131-146.
 * Conectado = comunicou há até 60 min (online ≤30 min, S/RESP 30–60 min).
 * Moto calada há menos de 2 dias é "sleep" no Mapa, não offline.
 */
export const SEM_RESP_ATE_MS = 60 * 60 * 1000;
export const SLEEP_MOTO_ATE_MS = 2 * 24 * 60 * 60 * 1000;

export type SituacaoOffline = 'OFFLINE' | 'NUNCA_REPORTOU';

/** null = o Mapa não mostraria como offline (conectado ou moto em sleep). */
export function classificarOffline(
  ultima: Date | null,
  tipo: string,
  agora: number,
): SituacaoOffline | null {
  if (!ultima || !Number.isFinite(ultima.getTime())) return 'NUNCA_REPORTOU';
  const idade = agora - ultima.getTime();
  if (idade <= SEM_RESP_ATE_MS) return null;
  if (tipo === 'MOTORCYCLE' && idade < SLEEP_MOTO_ATE_MS) return null;
  return 'OFFLINE';
}

export interface OfflineEquipmentRow {
  placa: string;
  modeloVeiculo: string | null;
  cliente: string | null;
  imei: string;
  iccid: string | null;
  numeroChip: string | null;
  operadora: string | null;
  ultimaComunicacao: string | null;
  situacao: SituacaoOffline;
  instaladoEm: string | null;
}

@Injectable()
export class OfflineEquipmentService {
  private readonly logger = new Logger(OfflineEquipmentService.name);

  constructor(
    private prisma: PrismaService,
    private traccar: TraccarService,
  ) {}

  async listar(tenantId: string) {
    const devices = await this.prisma.device.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: 'INSTALLED',
        vehicle: { is: { deletedAt: null, tenantId } },
      },
      select: {
        imei: true,
        lastConnection: true,
        installedAt: true,
        vehicle: {
          select: {
            plate: true,
            brand: true,
            model: true,
            vehicleType: true,
            associate: { select: { name: true } },
          },
        },
      },
    });

    const imeis = devices.map((d) => d.imei);
    const [stock, traccarDevices] = await Promise.all([
      imeis.length
        ? this.prisma.stockItem.findMany({
            where: { tenantId, imei: { in: imeis }, deletedAt: null },
            select: { imei: true, iccid: true, line: true, operator: true },
          })
        : Promise.resolve([]),
      this.traccar.getDevices({ all: true }).catch((e) => {
        this.logger.warn(
          `Traccar indisponível, usando last_connection: ${e instanceof Error ? e.message : e}`,
        );
        return [];
      }),
    ]);
    const chipPorImei = new Map(stock.map((s) => [s.imei, s]));
    const updatePorImei = new Map(
      traccarDevices.map((t) => [t.uniqueId, t.lastUpdate]),
    );

    const agora = Date.now();
    const data: OfflineEquipmentRow[] = [];
    for (const d of devices) {
      const v = d.vehicle;
      if (!v) continue;
      const lu = updatePorImei.get(d.imei);
      const ultima = lu ? new Date(lu) : d.lastConnection;
      const situacao = classificarOffline(ultima, v.vehicleType, agora);
      if (!situacao) continue;
      const chip = chipPorImei.get(d.imei);
      data.push({
        placa: v.plate,
        modeloVeiculo: [v.brand, v.model].filter(Boolean).join(' ') || null,
        cliente: v.associate?.name ?? null,
        imei: d.imei,
        iccid: chip?.iccid ?? null,
        numeroChip: chip?.line ?? null,
        operadora: chip?.operator ?? null,
        ultimaComunicacao: ultima ? ultima.toISOString() : null,
        situacao,
        instaladoEm: d.installedAt ? d.installedAt.toISOString() : null,
      });
    }
    data.sort((a, b) => a.placa.localeCompare(b.placa));
    return {
      data,
      meta: { total: data.length, geradoEm: new Date(agora).toISOString() },
    };
  }

  async exportarXlsx(tenantId: string): Promise<Buffer> {
    const { data } = await this.listar(tenantId);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Equipamentos offline');
    sheet.columns = [
      { header: 'Placa', key: 'placa', width: 12 },
      { header: 'Veículo', key: 'modeloVeiculo', width: 24 },
      { header: 'Cliente', key: 'cliente', width: 30 },
      { header: 'IMEI', key: 'imei', width: 18 },
      { header: 'ICCID', key: 'iccid', width: 24 },
      { header: 'Nº do chip', key: 'numeroChip', width: 16 },
      { header: 'Operadora', key: 'operadora', width: 14 },
      { header: 'Situação', key: 'situacao', width: 16 },
      { header: 'Última comunicação', key: 'ultima', width: 20 },
      { header: 'Instalado em', key: 'instalado', width: 14 },
    ];
    // IMEI/ICCID/linha vão como texto: número longo o Excel arredonda.
    data.forEach((r) =>
      sheet.addRow({
        placa: r.placa,
        modeloVeiculo: r.modeloVeiculo ?? '',
        cliente: r.cliente ?? '',
        imei: r.imei,
        iccid: r.iccid ?? '',
        numeroChip: r.numeroChip ?? '',
        operadora: r.operadora ?? '',
        situacao: r.situacao === 'NUNCA_REPORTOU' ? 'Nunca reportou' : 'Offline',
        ultima: r.ultimaComunicacao
          ? new Date(r.ultimaComunicacao).toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            })
          : '',
        instalado: r.instaladoEm
          ? new Date(r.instaladoEm).toLocaleDateString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            })
          : '',
      }),
    );
    sheet.getRow(1).font = { bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
