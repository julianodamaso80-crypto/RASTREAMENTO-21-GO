import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { InstallationPendingRow } from './installation-pendings.types';

const COLUNAS: Array<{
  header: string;
  width: number;
  valor: (r: InstallationPendingRow) => string | number;
}> = [
  { header: 'Pendência', width: 34, valor: (r) => (r.pendingType === 'TRACKER' ? 'PENDENTE INSTALAÇÃO DE RASTREADOR' : 'PENDENTE INSTALAÇÃO DE TAG') },
  { header: 'Dias pendente', width: 14, valor: (r) => r.daysPending },
  { header: 'Nome completo', width: 38, valor: (r) => r.associateName },
  { header: 'CPF/CNPJ', width: 18, valor: (r) => r.cpf ?? '' },
  { header: 'Contato', width: 22, valor: (r) => r.phone ?? '' },
  { header: 'E-mail', width: 30, valor: (r) => r.email ?? '' },
  { header: 'Placa', width: 11, valor: (r) => r.plate },
  { header: 'Modelo', width: 45, valor: (r) => r.brandModel },
  { header: 'Tipo de veículo', width: 30, valor: (r) => r.vehicleType ?? '' },
  { header: 'Cidade', width: 22, valor: (r) => r.city ?? '' },
  { header: 'Bairro', width: 24, valor: (r) => r.neighborhood ?? '' },
  { header: 'Valor protegido', width: 17, valor: (r) => r.protectedValue },
  { header: 'Data de contrato', width: 16, valor: (r) => r.contractDate.split('-').reverse().join('/') },
  { header: 'Tabela de avaliação', width: 19, valor: (r) => r.evaluationTable ?? '' },
  { header: 'Consultor', width: 34, valor: (r) => r.consultantName ?? '' },
];

/** Mesmo layout do relatório que a operação já usa no SGA. */
@Injectable()
export class InstallationPendingsExportService {
  async toXlsx(linhas: InstallationPendingRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();

    this.adicionarAba(workbook, `Todos (${linhas.length})`, linhas);
    const tracker = linhas.filter((l) => l.pendingType === 'TRACKER');
    const tag = linhas.filter((l) => l.pendingType === 'TAG');
    this.adicionarAba(workbook, `Rastreador (${tracker.length})`, tracker);
    this.adicionarAba(workbook, `TAG (${tag.length})`, tag);

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private adicionarAba(
    workbook: ExcelJS.Workbook,
    nome: string,
    linhas: InstallationPendingRow[],
  ): void {
    const aba = workbook.addWorksheet(nome);
    aba.columns = COLUNAS.map((c) => ({ header: c.header, width: c.width }));

    const cabecalho = aba.getRow(1);
    cabecalho.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cabecalho.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF293C82' }, // navy da identidade 21 GO
    };

    for (const linha of linhas) {
      aba.addRow(COLUNAS.map((c) => c.valor(linha)));
    }

    aba.getColumn(12).numFmt = 'R$ #,##0.00';
    aba.autoFilter = { from: 'A1', to: { row: 1, column: COLUNAS.length } };
    aba.views = [{ state: 'frozen', ySplit: 1 }];
  }
}
