/**
 * Histórico do associado por dia ("Viagens e históricos" da Rede):
 * 1. Veículo de outro associado nunca é servido.
 * 2. Dia fora dos últimos 31 dias é recusado (mesmo teto da Rede).
 * 3. Cada viagem sai com o endereço das pontas resolvido no backend.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppDataService } from './app-data.service';

const HOJE = new Date('2026-10-08T15:00:00Z').getTime();

const VIAGEM = {
  startTime: '2026-10-08T12:00:00Z',
  endTime: '2026-10-08T12:10:00Z',
  startLat: -22.9,
  startLng: -43.2,
  endLat: -22.92,
  endLng: -43.22,
  distanceKm: 3.02,
  durationMin: 10,
  maxSpeed: 50,
  avgSpeed: 40,
  stopAfterMin: null,
  path: [],
};

function servico(opts: { veiculo?: any; viagens?: any[] } = {}) {
  const prisma: any = {
    vehicle: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.veiculo === undefined ? { traccarDeviceId: 895 } : opts.veiculo,
        ),
    },
  };
  const reports: any = {
    getJourney: jest.fn().mockResolvedValue({
      date: '2026-10-08',
      trips: opts.viagens ?? [],
    }),
  };
  const geocode: any = {
    chave: (c: { latitude: number; longitude: number }) =>
      `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`,
    lookupCached: jest
      .fn()
      .mockResolvedValue(new Map([['-22.9000,-43.2000', 'Rua A, 1 · Centro']])),
  };
  jest.spyOn(Date, 'now').mockReturnValue(HOJE);
  return {
    service: new AppDataService(prisma, {} as any, reports, geocode),
    reports,
  };
}

afterEach(() => jest.restoreAllMocks());

describe('AppDataService.getJourney', () => {
  it('recusa veículo que não é do associado', async () => {
    const { service } = servico({ veiculo: null });
    await expect(
      service.getJourney('a1', 't1', 'v-alheio', '2026-10-08'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sem rastreador devolve o dia vazio', async () => {
    const { service, reports } = servico({ veiculo: { traccarDeviceId: null } });
    await expect(
      service.getJourney('a1', 't1', 'v1', '2026-10-08'),
    ).resolves.toEqual({ date: '2026-10-08', trips: [] });
    expect(reports.getJourney).not.toHaveBeenCalled();
  });

  it('recusa dia com mais de 31 dias e dia no futuro', async () => {
    const { service } = servico();
    await expect(
      service.getJourney('a1', 't1', 'v1', '2026-08-01'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getJourney('a1', 't1', 'v1', '2026-10-09'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aceita hoje e o limite de 31 dias', async () => {
    const { service } = servico();
    await expect(
      service.getJourney('a1', 't1', 'v1', '2026-10-08'),
    ).resolves.toBeDefined();
    await expect(
      service.getJourney('a1', 't1', 'v1', '2026-09-07'),
    ).resolves.toBeDefined();
  });

  it('entrega o endereço das pontas e deixa nulo o que não conhece', async () => {
    const { service } = servico({ viagens: [VIAGEM] });
    const { trips } = await service.getJourney('a1', 't1', 'v1', '2026-10-08');
    expect(trips[0].startAddress).toBe('Rua A, 1 · Centro');
    expect(trips[0].endAddress).toBeNull();
    expect(trips[0].distanceKm).toBe(3.02);
  });
});

describe('AppDataService.getHistoryReport', () => {
  function com(opts: { veiculo?: any; relatorio?: any } = {}) {
    const prisma: any = {
      vehicle: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.veiculo === undefined
              ? { traccarDeviceId: 895, plate: 'ABC1D23' }
              : opts.veiculo,
          ),
      },
    };
    const reports: any = {
      getHistoryReport: jest.fn().mockResolvedValue(
        opts.relatorio ?? {
          totals: { distanceKm: 3, ignitionOnMin: 20, ignitionOffMin: 10 },
          rows: [
            { time: '2026-10-08T12:00:00Z', lat: -22.9, lng: -43.2, speed: 0, ignition: false, event: null, distanceM: null },
          ],
          days: [],
        },
      ),
    };
    const geocode: any = {
      chave: (c: { latitude: number; longitude: number }) =>
        `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`,
      lookupCached: jest
        .fn()
        .mockResolvedValue(new Map([['-22.9000,-43.2000', 'Rua A, 1 · Centro']])),
    };
    jest.spyOn(Date, 'now').mockReturnValue(HOJE);
    return { service: new AppDataService(prisma, {} as any, reports, geocode), reports };
  }

  const de = '2026-10-08T03:00:00Z';
  const ate = '2026-10-08T15:00:00Z';

  it('recusa veículo de outro associado', async () => {
    const { service } = com({ veiculo: null });
    await expect(
      service.getHistoryReport('a1', 't1', 'v-alheio', de, ate, 'basico'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recusa período além de 31 dias', async () => {
    const { service } = com();
    await expect(
      service.getHistoryReport('a1', 't1', 'v1', '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z', 'basico'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('entrega placa, totais e endereço — sem IMEI nem id de rastreador', async () => {
    const { service } = com();
    const r: any = await service.getHistoryReport('a1', 't1', 'v1', de, ate, 'basico');
    expect(r.plate).toBe('ABC1D23');
    expect(r.rows[0].address).toBe('Rua A, 1 · Centro');
    expect(r.totals.distanceKm).toBe(3);
    expect(JSON.stringify(r)).not.toMatch(/imei|traccarDeviceId|895/i);
  });
});
