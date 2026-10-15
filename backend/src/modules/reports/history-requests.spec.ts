import {
  ConflictException,
  GoneException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { HistoryRequestsService, linkPublico } from './history-requests.service';
import { gerarHistoricoPdf, linkDoEndereco, linkDoMapa } from './history-report.pdf';

function servico(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
    historyReportRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    ...prismaOverrides,
  };
  const reports = {
    getHistoryReport: jest.fn().mockResolvedValue({
      totals: { distanceKm: 1.2, ignitionOnMin: 10, ignitionOffMin: 5 },
      rows: [
        {
          time: '2026-10-13T10:42:00.000Z',
          lat: -16.6869,
          lng: -49.2648,
          speed: 0,
          ignition: true,
          event: null,
          distanceM: null,
        },
      ],
      days: [],
    }),
  };
  const geocode = {
    lookupLote: jest.fn().mockResolvedValue(new Map()),
    chave: jest.fn().mockReturnValue(null),
  };
  const s = new HistoryRequestsService(prisma as never, reports as never, geocode as never);
  return { s, prisma, reports };
}

const TOKEN = 'a'.repeat(43);

describe('HistoryRequestsService', () => {
  it('link público recusa código fora do formato sem consultar o banco', async () => {
    const { s, prisma } = servico();
    await expect(s.pdfPorToken('../etc')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.historyReportRequest.findFirst).not.toHaveBeenCalled();
  });

  it('link vencido responde 410', async () => {
    const { s, prisma } = servico();
    prisma.historyReportRequest.findFirst.mockResolvedValue({
      pdf: new Uint8Array([1]),
      plate: 'ABC1D23',
      from: new Date(),
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(s.pdfPorToken(TOKEN)).rejects.toBeInstanceOf(GoneException);
  });

  it('link válido devolve o PDF gravado', async () => {
    const { s, prisma } = servico();
    prisma.historyReportRequest.findFirst.mockResolvedValue({
      pdf: new Uint8Array([37, 80, 68, 70]),
      plate: 'ABC1D23',
      from: new Date('2026-10-13T03:00:00Z'),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const r = await s.pdfPorToken(TOKEN);
    expect(r.pdf.toString()).toBe('%PDF');
    expect(r.nome).toBe('historico-ABC1D23-2026-10-13.pdf');
    expect(prisma.historyReportRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { shareToken: TOKEN } }),
    );
  });

  it('associado sem identificação não lista nem baixa (where undefined listaria todos)', async () => {
    const { s, prisma } = servico();
    await expect(s.listarDoAssociado('t1', undefined as never, 'v1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(s.pdfDoAssociado('t1', '', 'x')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.historyReportRequest.findMany).not.toHaveBeenCalled();
  });

  it('associado só lista o que ele mesmo pediu e não vê nome de operador', async () => {
    const { s, prisma } = servico();
    prisma.historyReportRequest.findMany.mockResolvedValue([
      {
        id: '11111111-2222-4333-a444-555555555555',
        plate: 'ABC1D23',
        from: new Date(),
        to: new Date(),
        type: 'basico',
        source: 'APP',
        requestedByName: 'Fulano',
        shareToken: TOKEN,
        expiresAt: new Date(Date.now() + 1000),
        rowCount: 1,
        pdfSize: 10,
        createdAt: new Date(),
      },
    ]);
    const lista = await s.listarDoAssociado('t1', 'a1', 'v1');
    expect(prisma.historyReportRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1', vehicleId: 'v1', requestedByAssociateId: 'a1' },
      }),
    );
    expect(lista[0].requestedByName).toBeNull();
    expect(lista[0].url).toBe(linkPublico(TOKEN));
    expect(lista[0]).not.toHaveProperty('shareToken');
  });

  it('no app só gera para veículo do próprio associado', async () => {
    const { s, prisma } = servico();
    await expect(
      s.criar({
        tenantId: 't1',
        vehicleId: 'v1',
        from: '2026-10-13T00:00:00Z',
        to: '2026-10-13T23:59:00Z',
        type: 'basico',
        maxDias: 31,
        solicitante: { origem: 'APP', associateId: 'a1' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.vehicle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 't1', associateId: 'a1' }),
      }),
    );
  });

  it('gera, grava o PDF e devolve o link', async () => {
    const { s, prisma } = servico();
    prisma.vehicle.findFirst.mockResolvedValue({
      id: 'v1',
      plate: 'ABC1D23',
      brand: 'Renault',
      model: 'Logan',
      traccarDeviceId: 7,
      associate: { name: 'Maria' },
    });
    prisma.historyReportRequest.create.mockImplementation(async ({ data }) => ({
      ...data,
      requestedByName: data.requestedByName,
    }));
    const item = await s.criar({
      tenantId: 't1',
      vehicleId: 'v1',
      from: '2026-10-13T00:00:00Z',
      to: '2026-10-13T23:59:00Z',
      type: 'basico',
      maxDias: 90,
      solicitante: { origem: 'PAINEL', userId: 'u1', nome: 'Operador' },
    });
    const data = prisma.historyReportRequest.create.mock.calls[0][0].data;
    expect(Buffer.from(data.pdf).subarray(0, 4).toString()).toBe('%PDF');
    expect(data.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.expiresAt.getTime() - data.createdAt.getTime()).toBe(90 * 24 * 3600_000);
    expect(item.url).toBe(linkPublico(data.shareToken));
    expect(item.requestedByName).toBe('Operador');
  });
});

describe('HistoryRequestsService — um PDF por veículo por vez', () => {
  it('segundo pedido do mesmo veículo enquanto o primeiro gera recebe 409', async () => {
    const { s, prisma, reports } = servico();
    prisma.vehicle.findFirst.mockResolvedValue({
      id: 'v1',
      plate: 'ABC1D23',
      brand: null,
      model: null,
      traccarDeviceId: 7,
      associate: null,
    });
    let liberar!: () => void;
    const original = reports.getHistoryReport.getMockImplementation()!;
    reports.getHistoryReport.mockImplementationOnce(
      (...a: unknown[]) => new Promise((ok) => (liberar = () => ok(original(...a)))),
    );
    prisma.historyReportRequest.create.mockImplementation(async ({ data }) => data);
    const p = {
      tenantId: 't1',
      vehicleId: 'v1',
      from: '2026-10-13T00:00:00Z',
      to: '2026-10-13T23:59:00Z',
      type: 'basico',
      maxDias: 90,
      solicitante: { origem: 'PAINEL' as const },
    };
    const primeiro = s.criar(p);
    await new Promise((r) => setImmediate(r));
    await expect(s.criar(p)).rejects.toBeInstanceOf(ConflictException);
    liberar();
    await expect(primeiro).resolves.toBeDefined();
    await expect(s.criar(p)).resolves.toBeDefined();
  });
});

describe('gerarHistoricoPdf', () => {
  it('cada posição tem link para o Google Maps', async () => {
    const pdf = await gerarHistoricoPdf({
      numero: 'ABC123',
      plate: 'ABC1D23',
      veiculo: 'Renault Logan',
      associado: 'Maria',
      from: '2026-10-13T03:00:00Z',
      to: '2026-10-14T02:59:00Z',
      type: 'basico',
      totals: { distanceKm: 12.3, ignitionOnMin: 90, ignitionOffMin: 30 },
      rows: [
        {
          time: '2026-10-13T10:42:00.000Z',
          lat: -16.6869,
          lng: -49.2648,
          speed: 42,
          ignition: true,
          event: 'Ignição ligada',
          address: 'Av. T-63, 1440 - Setor Bueno, Goiânia - GO',
        },
      ],
      days: [],
      geradoEm: new Date(),
    });
    const texto = pdf.toString('latin1');
    expect(texto.startsWith('%PDF')).toBe(true);
    expect(texto).toContain(linkDoMapa(-16.6869, -49.2648));
    expect(texto).toContain(
      linkDoEndereco(-16.6869, -49.2648, 'Av. T-63, 1440 - Setor Bueno, Goiânia - GO'),
    );
  });

  it('link do endereço abre a rua; endereço só com a cidade cai na coordenada', () => {
    expect(linkDoEndereco(-22.8, -43.4, 'Rua Barão de Piraquara, Rio de Janeiro - RJ')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Rua%20Bar%C3%A3o%20de%20Piraquara%2C%20Rio%20de%20Janeiro%20-%20RJ',
    );
    expect(linkDoEndereco(-22.8, -43.4, 'Rio de Janeiro - RJ')).toBe(linkDoMapa(-22.8, -43.4));
    expect(linkDoEndereco(-22.8, -43.4, null)).toBe(linkDoMapa(-22.8, -43.4));
  });
});
