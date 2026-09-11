import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { LinhaLista } from './appointments.service';

const NAO_INFORMADO = 'Não informado';

const SERVICO: Record<string, string> = {
  INSTALLATION: 'Instalação',
  MAINTENANCE: 'Manutenção',
  REMOVAL: 'Retirada',
  OTHER: 'Outros',
};

const CONDUCAO: Record<string, string> = {
  FIXED_POINT: 'Ponto fixo',
  MOBILE: 'Volante',
};

/// Status escrito como a origem escreve na planilha (minúsculo).
const STATUS: Record<string, string> = {
  SCHEDULED: 'agendado',
  CANCELED: 'cancelado',
  COMPLETED: 'concluído',
  POSTPONED: 'prorrogado',
  ANTICIPATED: 'adiantado',
  FRUSTRATED_CLIENT: 'visita frustrada cliente',
  FRUSTRATED_TECHNICIAN: 'visita frustrada técnico',
  CLOSED_BY_SYSTEM: 'concluído pelo sistema',
  EXECUTED: 'auto-agendamento executado',
  CLIENT_NO_SHOW: 'auto-agendamento cliente não compareceu',
  CANCELED_BY_CLIENT: 'auto-agendamento cancelado pelo cliente',
};

function dia(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function hora(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/// As 19 colunas do "Relatório Agendamento" da origem, na mesma ordem e com o
/// mesmo cabeçalho (medido em 11/09/2026). "Imei Novo" e "Modelo Novo" existem
/// lá para a troca de equipamento; aqui ainda não há troca registrada na OS.
const COLUNAS: Array<{
  header: string;
  width: number;
  valor: (r: LinhaLista) => string | number;
}> = [
  { header: 'Colaborador', width: 34, valor: (r) => r.technician.name },
  { header: 'Serviço', width: 14, valor: (r) => SERVICO[r.serviceType] ?? r.serviceType },
  { header: 'Descrição do serviço', width: 30, valor: (r) => r.description || NAO_INFORMADO },
  { header: 'Condução do serviço', width: 18, valor: (r) => CONDUCAO[r.conduction] ?? r.conduction },
  { header: 'Status', width: 26, valor: (r) => STATUS[r.status] ?? r.status },
  { header: 'Data agendamento', width: 16, valor: (r) => dia(r.scheduledStart) },
  { header: 'Horário de início', width: 16, valor: (r) => hora(r.scheduledStart) },
  { header: 'Horário de fim', width: 14, valor: (r) => hora(r.scheduledEnd) },
  { header: 'Valor', width: 12, valor: (r) => (Number(r.value) > 0 ? Number(r.value) : '-') },
  { header: 'Marca', width: 16, valor: (r) => r.brand || NAO_INFORMADO },
  { header: 'Modelo', width: 36, valor: (r) => r.model || NAO_INFORMADO },
  { header: 'Placa/Chassi', width: 20, valor: (r) => r.plate || r.chassi || NAO_INFORMADO },
  { header: 'Nome do cliente', width: 36, valor: (r) => r.clientName || NAO_INFORMADO },
  { header: 'CPF/CNPJ', width: 18, valor: (r) => r.cpfCnpj || NAO_INFORMADO },
  { header: 'Endereço', width: 50, valor: (r) => r.address || NAO_INFORMADO },
  { header: 'Imei', width: 18, valor: (r) => r.imei || NAO_INFORMADO },
  { header: 'Modelo', width: 14, valor: (r) => r.vehicle?.device?.model || NAO_INFORMADO },
  { header: 'Imei Novo', width: 18, valor: () => NAO_INFORMADO },
  { header: 'Modelo Novo', width: 14, valor: () => NAO_INFORMADO },
];

@Injectable()
export class AppointmentsExportService {
  async toXlsx(linhas: LinhaLista[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const aba = workbook.addWorksheet('Relatório Agendamento');
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

    const colunaValor = COLUNAS.findIndex((c) => c.header === 'Valor') + 1;
    aba.getColumn(colunaValor).numFmt = 'R$ #,##0.00';
    aba.autoFilter = { from: 'A1', to: { row: 1, column: COLUNAS.length } };
    aba.views = [{ state: 'frozen', ySplit: 1 }];

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
