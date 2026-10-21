import { UnprocessableEntityException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import PDFDocument = require('pdfkit');
import { StockBulkLinkService } from './stock-bulk-link.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

function servico(over: {
  stockItem?: any;
  device?: any;
  associate?: jest.Mock;
}) {
  const prisma: any = {
    stockItem: {
      findFirst: jest.fn().mockResolvedValue(over.stockItem ?? null),
      upsert: jest.fn().mockResolvedValue({ id: 'novo-id' }),
      update: jest.fn().mockResolvedValue({}),
    },
    device: { findFirst: jest.fn().mockResolvedValue(over.device ?? null) },
  };
  const stock: any = {
    associate: over.associate ?? jest.fn().mockResolvedValue({ ok: true }),
  };
  return { svc: new StockBulkLinkService(prisma, stock), prisma, stock };
}

const linha = {
  linha: 2,
  placa: 'ABC1D23',
  imei: '865190072049441',
  tecnico: 'João',
  local: 'Painel',
};

describe('StockBulkLinkService.vincular', () => {
  it('IMEI fora do estoque entra no estoque e vincula pelo associate', async () => {
    const { svc, prisma, stock } = servico({});
    const [r] = await svc.vincular(TENANT, [linha]);
    expect(r.status).toBe('VINCULADO');
    expect(prisma.stockItem.upsert).toHaveBeenCalled();
    expect(stock.associate).toHaveBeenCalledWith(
      'novo-id',
      TENANT,
      { placa: 'ABC1D23', technicianName: 'João', installLocation: 'Painel' },
      false,
    );
  });

  it('TAG de 11 dígitos que está no Estoque como TAG vincula pelo associate', async () => {
    const { svc, prisma, stock } = servico({
      stockItem: { id: 'tag-id', associatedAt: null, kind: 'TAG' },
    });
    const [r] = await svc.vincular(TENANT, [{ ...linha, imei: '92603018558' }]);
    expect(r.status).toBe('VINCULADO');
    expect(prisma.stockItem.findFirst).toHaveBeenCalledWith({
      where: { tenantId: TENANT, imei: '92603018558', deletedAt: null, kind: 'TAG' },
    });
    expect(stock.associate).toHaveBeenCalledWith(
      'tag-id',
      TENANT,
      { placa: 'ABC1D23', technicianName: 'João', installLocation: 'Painel' },
      false,
    );
  });

  it('ID de 11 dígitos que NÃO é TAG do Estoque não entra no estoque (pode ser erro de digitação)', async () => {
    const { svc, prisma, stock } = servico({});
    const [r] = await svc.vincular(TENANT, [{ ...linha, imei: '92603018558' }]);
    expect(r.status).toBe('ERRO');
    expect(r.motivo).toMatch(/não está no Estoque como TAG/);
    expect(prisma.stockItem.upsert).not.toHaveBeenCalled();
    expect(stock.associate).not.toHaveBeenCalled();
  });

  it('tamanho que não é de IMEI nem de TAG continua recusado no serviço', async () => {
    const { svc, stock } = servico({});
    const [r] = await svc.vincular(TENANT, [{ ...linha, imei: '926030185581' }]);
    expect(r.status).toBe('ERRO');
    expect(r.motivo).toMatch(/15 dígitos/);
    expect(stock.associate).not.toHaveBeenCalled();
  });

  it('nunca libera associado inativo (allowInactive nem é enviado)', async () => {
    const { svc, stock } = servico({});
    await svc.vincular(TENANT, [linha]);
    const dto = stock.associate.mock.calls[0][2];
    expect(dto.allowInactive).toBeUndefined();
    expect(stock.associate.mock.calls[0][3]).toBe(false);
  });

  it('erro do associate vira o motivo da linha e tira do estoque o item criado agora', async () => {
    const associate = jest
      .fn()
      .mockRejectedValue(
        new UnprocessableEntityException(
          'Placa ABC1D23 está INATIVA no SGA — vínculo bloqueado.',
        ),
      );
    const { svc, prisma } = servico({ associate });
    const [r] = await svc.vincular(TENANT, [linha]);
    expect(r.status).toBe('ERRO');
    expect(r.motivo).toMatch(/INATIVA no SGA/);
    expect(prisma.stockItem.update).toHaveBeenCalledWith({
      where: { id: 'novo-id' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('item que já estava no estoque não é apagado quando o vínculo falha', async () => {
    const associate = jest
      .fn()
      .mockRejectedValue(new UnprocessableEntityException('Placa não encontrada'));
    const { svc, prisma } = servico({
      stockItem: { id: 'velho', associatedAt: null },
      associate,
    });
    const [r] = await svc.vincular(TENANT, [linha]);
    expect(r.status).toBe('ERRO');
    expect(prisma.stockItem.upsert).not.toHaveBeenCalled();
    expect(prisma.stockItem.update).not.toHaveBeenCalled();
  });

  it('IMEI já vinculado à mesma placa é "já vinculado", sem mexer em nada', async () => {
    const { svc, stock } = servico({
      stockItem: { id: 'x', associatedAt: new Date() },
      device: { vehicle: { plate: 'ABC1D23', chassi: null } },
    });
    const [r] = await svc.vincular(TENANT, [linha]);
    expect(r.status).toBe('JA_VINCULADO');
    expect(stock.associate).not.toHaveBeenCalled();
  });

  it('IMEI já vinculado a outra placa é erro e diz qual', async () => {
    const { svc } = servico({
      stockItem: { id: 'x', associatedAt: new Date() },
      device: { vehicle: { plate: 'ZZZ9Z99', chassi: null } },
    });
    const [r] = await svc.vincular(TENANT, [linha]);
    expect(r.status).toBe('ERRO');
    expect(r.motivo).toMatch(/ZZZ9Z99/);
  });

  it('uma linha com erro não impede as seguintes', async () => {
    const associate = jest
      .fn()
      .mockRejectedValueOnce(new UnprocessableEntityException('falhou'))
      .mockResolvedValueOnce({ ok: true });
    const { svc } = servico({ associate });
    const r = await svc.vincular(TENANT, [
      linha,
      { ...linha, linha: 3, imei: '865190072049442', placa: 'XYZ9K88' },
    ]);
    expect(r.map((x) => x.status)).toEqual(['ERRO', 'VINCULADO']);
  });
});

describe('StockBulkLinkService.ler', () => {
  const { svc } = servico({});

  it('lê .xlsx, com o IMEI numérico sem virar notação científica', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('a');
    ws.addRow(['Placa', 'IMEI', 'Técnico', 'Local']);
    ws.addRow(['ABC1D23', 865190072049441, 'João', 'Painel']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await svc.ler(buf, 'lista.xlsx');
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].erro).toBeUndefined();
    expect(r.linhas[0].imei).toBe('865190072049441');
  });

  it('lê PDF em tabela', async () => {
    const doc = new PDFDocument({ size: 'A4', margin: 30 });
    const partes: Buffer[] = [];
    doc.on('data', (d: Buffer) => partes.push(d));
    const fim = new Promise<void>((ok) => doc.on('end', () => ok()));
    const linhasPdf = [
      ['Placa', 'IMEI', 'Tecnico', 'Local'],
      ['ABC1D23', '865190072049441', 'Joao Silva', 'Painel'],
      ['XYZ9K88', '865190072049442', 'Pedro', 'Sob o banco'],
    ];
    let y = 60;
    for (const l of linhasPdf) {
      l.forEach((txt, i) => doc.fontSize(10).text(txt, 40 + i * 130, y, { lineBreak: false }));
      y += 20;
    }
    doc.end();
    await fim;
    const r = await svc.ler(Buffer.concat(partes), 'lista.PDF');
    expect(r.erroGeral).toBeUndefined();
    expect(r.linhas.map((l) => [l.placa, l.imei, l.tecnico, l.local])).toEqual([
      ['ABC1D23', '865190072049441', 'Joao Silva', 'Painel'],
      ['XYZ9K88', '865190072049442', 'Pedro', 'Sob o banco'],
    ]);
  });

  it('recusa formato que não é planilha nem PDF', async () => {
    await expect(svc.ler(Buffer.from('x'), 'foto.png')).rejects.toThrow(
      /xlsx ou um PDF/,
    );
  });
});
