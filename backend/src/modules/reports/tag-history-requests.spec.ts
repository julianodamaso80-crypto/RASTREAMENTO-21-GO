import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TagHistoryRequestsService } from './tag-history-requests.service';
import { gerarHistoricoTagPdf, AVISO_TAG } from '../ble-tags/tag-history-report.pdf';

const TENANT = '11111111-1111-1111-1111-111111111111';
const SERIAL = '808092604070640';

function agoraMenos(horas: number): Date {
  return new Date(Date.now() - horas * 3600_000);
}

function servico(over: { vinculo?: unknown; posicoes?: unknown[] } = {}) {
  const prisma = {
    tagLink: {
      findFirst: jest.fn().mockResolvedValue(
        over.vinculo === undefined
          ? { plate: 'RJN7C24', associateName: 'JEFERSON DORNELAS DE OLIVEIRA' }
          : over.vinculo,
      ),
    },
    vehicle: {
      findFirst: jest.fn().mockResolvedValue({ brand: 'HONDA', model: 'CG 160 TITAN' }),
    },
    tagPosition: {
      findMany: jest.fn().mockResolvedValue(
        over.posicoes ?? [
          {
            seenAt: agoraMenos(5),
            receivedAt: agoraMenos(4.8),
            latitude: -22.86756,
            longitude: -43.23653,
            accuracyM: 82,
            source: 'APPLE_FINDMY',
          },
        ],
      ),
    },
    historyReportRequest: {
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: data.id,
        plate: data.plate,
        from: data.from,
        to: data.to,
        type: data.type,
        source: data.source,
        requestedByName: data.requestedByName,
        shareToken: data.shareToken,
        expiresAt: data.expiresAt,
        rowCount: data.rowCount,
        pdfSize: data.pdfSize,
        createdAt: data.createdAt,
      })),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const geocode = {
    lookupLote: jest.fn().mockResolvedValue(new Map()),
    chave: jest.fn().mockReturnValue(null),
  };
  const s = new TagHistoryRequestsService(prisma as never, geocode as never);
  return { s, prisma };
}

const periodo = () => ({
  from: agoraMenos(24).toISOString(),
  to: new Date().toISOString(),
});

describe('TagHistoryRequestsService', () => {
  it('consulta lê só avistamentos da empresa e do número da TAG, no período', async () => {
    const { s, prisma } = servico();
    const p = periodo();
    const r = await s.consultar(TENANT, SERIAL, p.from, p.to, 'basico');
    expect(prisma.tagLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, serialNumber: SERIAL, deletedAt: null } }),
    );
    const onde = prisma.tagPosition.findMany.mock.calls[0][0].where;
    expect(onde).toMatchObject({ tenantId: TENANT, serialNumber: SERIAL });
    expect(onde.seenAt.gte).toEqual(new Date(p.from));
    expect(r.plate).toBe('RJN7C24');
    expect(r.totals.sightings).toBe(1);
    expect(r.rows).toHaveLength(1);
  });

  it('TAG sem vínculo com veículo responde 404 e nem lê posições', async () => {
    const { s, prisma } = servico({ vinculo: null });
    const p = periodo();
    await expect(s.consultar(TENANT, SERIAL, p.from, p.to, 'basico')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.tagPosition.findMany).not.toHaveBeenCalled();
  });

  it('período inválido é recusado antes de qualquer consulta ao banco', async () => {
    const { s, prisma } = servico();
    await expect(
      s.consultar(TENANT, SERIAL, '2026-10-22T00:00:00Z', '2026-10-21T00:00:00Z', 'basico'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tagLink.findFirst).not.toHaveBeenCalled();
  });

  it('PDF gravado é da TAG: sem veículo, com o número da TAG, link e validade', async () => {
    const { s, prisma } = servico();
    const p = periodo();
    const item = await s.criar({
      tenantId: TENANT,
      serial: SERIAL,
      ...p,
      type: 'avancado',
      solicitante: { userId: 'u1', nome: 'Operador' },
    });
    const dados = prisma.historyReportRequest.create.mock.calls[0][0].data;
    expect(dados).toMatchObject({
      tenantId: TENANT,
      vehicleId: null,
      tagSerial: SERIAL,
      plate: 'RJN7C24',
      source: 'PAINEL',
      requestedByUserId: 'u1',
      type: 'avancado',
      rowCount: 1,
    });
    expect(Buffer.from(dados.pdf).subarray(0, 4).toString()).toBe('%PDF');
    expect(item.url).toMatch(/\/api\/v1\/public\/historico\/.{43}$/);
    expect(item.expired).toBe(false);
  });

  it('segundo pedido enquanto o primeiro gera é recusado (409) e o botão destrava depois', async () => {
    const { s, prisma } = servico();
    const p = periodo();
    const gerar = () =>
      s.criar({ tenantId: TENANT, serial: SERIAL, ...p, type: 'basico', solicitante: {} });
    const primeiro = gerar();
    await expect(gerar()).rejects.toBeInstanceOf(ConflictException);
    await primeiro;
    await expect(gerar()).resolves.toBeDefined();
    expect(prisma.historyReportRequest.create).toHaveBeenCalledTimes(2);
  });

  it('lista só o que foi gerado para aquela TAG, dentro da empresa', async () => {
    const { s, prisma } = servico();
    await s.listar(TENANT, SERIAL);
    expect(prisma.historyReportRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, tagSerial: SERIAL } }),
    );
  });
});

describe('gerarHistoricoTagPdf', () => {
  const base = {
    numero: 'ABC1234567',
    plate: 'RJN7C24',
    serial: SERIAL,
    veiculo: 'HONDA CG 160 TITAN',
    associado: 'JEFERSON DORNELAS DE OLIVEIRA',
    from: '2026-10-20T03:00:00.000Z',
    to: '2026-10-24T03:00:00.000Z',
    totals: { sightings: 3, places: 2, days: 2, firstSeen: '2026-10-20T12:00:00.000Z', lastSeen: '2026-10-21T12:00:00.000Z' },
    geradoEm: new Date('2026-10-24T14:00:00Z'),
  };
  const linha = {
    time: '2026-10-20T12:00:00.000Z',
    untilTime: '2026-10-20T13:00:00.000Z',
    count: 3,
    lat: -22.86756,
    lng: -43.23653,
    accuracyM: 82,
    address: 'Rua Marcus Vinícius da Silva, Rio de Janeiro - RJ',
  };

  it.each(['basico', 'avancado', 'consolidado'] as const)('gera um PDF válido (%s)', async (type) => {
    const pdf = await gerarHistoricoTagPdf({
      ...base,
      type,
      rows: type === 'consolidado' ? [] : [linha, { ...linha, time: '2026-10-21T12:00:00.000Z', untilTime: '2026-10-21T12:00:00.000Z', count: 1, source: 'APPLE_FINDMY', delayMin: 13 }],
      days: type === 'consolidado'
        ? [{ date: '2026-10-20', count: 2, firstSeen: '2026-10-20T12:00:00.000Z', lastSeen: '2026-10-20T13:00:00.000Z', lat: -22.86756, lng: -43.23653, address: null }]
        : [],
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it('o aviso do PDF não promete GPS, trajeto, km nem tempo real', () => {
    expect(AVISO_TAG).toMatch(/não tem GPS próprio/);
    expect(AVISO_TAG).toMatch(/não o trajeto|não o trajeto percorrido|e não o trajeto/);
    expect(AVISO_TAG).not.toMatch(/\bkm\b|quilometr|tempo real|ignição|ao vivo/i);
  });

  it('com muitas linhas quebra em várias páginas sem estourar', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({
      ...linha,
      time: new Date(Date.parse('2026-10-20T12:00:00Z') + i * 3600_000).toISOString(),
      untilTime: new Date(Date.parse('2026-10-20T12:00:00Z') + i * 3600_000).toISOString(),
      count: 1,
    }));
    const pdf = await gerarHistoricoTagPdf({ ...base, type: 'basico', rows, days: [] });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
