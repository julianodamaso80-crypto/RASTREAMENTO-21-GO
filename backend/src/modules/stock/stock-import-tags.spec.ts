import * as ExcelJS from 'exceljs';
import { StockService } from './stock.service';

/**
 * "Importar planilha" com o arquivo do fabricante das TAGs (dono, 24/09/2026).
 * O arquivo vem com cabeçalho em chinês — SN码 | Key名称（苹果） | MAC地址 |
 * privateKey值 | hashedAdvKey值 — e algumas chaves com "=" na frente. Cada linha
 * vira chave (tag_keys, que o coletor Find My lê sozinho) + TAG livre no
 * Estoque. Nada vai para o servidor GPS: TAG não é rastreador.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const CABECALHO = ['SN码', 'Key名称（苹果）', 'MAC地址', 'privateKey值', 'hashedAdvKey值'];
const PK = '/UoJIqef+l4XXXpV9huQ4NSj9xLdm2jQ5anlmQ=='; // 28 bytes
const HASH = '8K8SQ8kFG1j8NISKD0QMTDnT9qrKDg1NN/jKFC2YwPA='; // 32 bytes

async function planilha(linhas: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Página1');
  ws.addRow(CABECALHO);
  for (const l of linhas) ws.addRow(l);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function montar(existentes: { stock?: unknown[]; links?: unknown[] } = {}) {
  const prisma = {
    tagKey: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn().mockResolvedValue({}) },
    tagLink: { findMany: jest.fn().mockResolvedValue(existentes.links ?? []) },
    stockItem: {
      findMany: jest.fn().mockResolvedValue(existentes.stock ?? []),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn(),
    },
  };
  const stockTraccar = { ensurePending: jest.fn().mockResolvedValue(undefined) };
  const s = new StockService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    stockTraccar as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { s, prisma, stockTraccar };
}

describe('Estoque — importar planilha de TAGs do fabricante', () => {
  it('grava chave e TAG livre, tirando o "=" da frente, sem tocar no servidor GPS', async () => {
    const { s, prisma, stockTraccar } = montar();
    const buf = await planilha([
      ['808092604068941', 'T55R7V', 'EA:3C:82:7B:92:F0', PK, HASH],
      ['808092604068958', 'T57ZGY', 'C9:88:AA:BB:FE:C1', `=${PK}`, `=${HASH}`],
    ]);

    const r = await s.importFromBuffer(buf, TENANT);

    expect(r).toEqual(expect.objectContaining({ tipo: 'TAG', imported: 2, updated: 0, skipped: 0, total: 2 }));
    expect(prisma.tagKey.upsert).toHaveBeenCalledWith({
      where: { tenantId_serialNumber: { tenantId: TENANT, serialNumber: '808092604068958' } },
      create: {
        tenantId: TENANT,
        serialNumber: '808092604068958',
        macAddress: 'C9:88:AA:BB:FE:C1',
        privateKey: PK,
        hashedAdvKey: HASH,
        batch: '808092',
      },
      update: { macAddress: 'C9:88:AA:BB:FE:C1', privateKey: PK, hashedAdvKey: HASH, batch: '808092' },
    });
    expect(prisma.stockItem.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT, imei: '808092604068941', kind: 'TAG', status: 'TAG', notes: 'Lote 808092' },
    });
    expect(prisma.stockItem.create).toHaveBeenCalledTimes(2);
    expect(prisma.stockItem.upsert).not.toHaveBeenCalled();
    expect(stockTraccar.ensurePending).not.toHaveBeenCalled();
  });

  it('recusa a linha com chave quebrada e conta como ignorada', async () => {
    const { s, prisma } = montar();
    const buf = await planilha([
      ['808092604068941', 'T55R7V', 'EA:3C:82:7B:92:F0', PK, HASH],
      ['808092604068958', 'T57ZGY', 'C9:88:AA:BB:FE:C1', '808092604068958', HASH],
    ]);

    const r = await s.importFromBuffer(buf, TENANT);

    expect(r).toEqual(expect.objectContaining({ imported: 1, skipped: 1, total: 1 }));
    expect(prisma.tagKey.upsert).toHaveBeenCalledTimes(1);
  });

  it('TAG já vinculada a cliente não volta pro estoque; a que já está no estoque não duplica', async () => {
    const { s, prisma } = montar({
      links: [{ serialNumber: '808092604068941' }],
      stock: [{ id: 'st-1', imei: '808092604068958', kind: 'TAG', deletedAt: null, associatedAt: null }],
    });
    const buf = await planilha([
      ['808092604068941', 'T55R7V', 'EA:3C:82:7B:92:F0', PK, HASH],
      ['808092604068958', 'T57ZGY', 'C9:88:AA:BB:FE:C1', PK, HASH],
    ]);

    const r = await s.importFromBuffer(buf, TENANT);

    expect(prisma.stockItem.create).not.toHaveBeenCalled();
    expect(prisma.tagKey.upsert).toHaveBeenCalledTimes(2); // a chave sempre é gravada
    expect(r).toEqual(expect.objectContaining({ imported: 0, updated: 2 }));
  });

  it('número de TAG que já é rastreador no estoque não vira TAG', async () => {
    const { s, prisma } = montar({
      stock: [{ id: 'st-1', imei: '808092604068941', kind: 'RASTREADOR', deletedAt: null, associatedAt: null }],
    });
    const buf = await planilha([['808092604068941', 'T55R7V', 'EA:3C:82:7B:92:F0', PK, HASH]]);

    const r = await s.importFromBuffer(buf, TENANT);

    expect(prisma.stockItem.create).not.toHaveBeenCalled();
    expect(prisma.stockItem.update).not.toHaveBeenCalled();
    expect(prisma.tagKey.upsert).not.toHaveBeenCalled();
    expect(r).toEqual(expect.objectContaining({ imported: 0, skipped: 1 }));
  });
});
