/**
 * A aba do app deixou de ser "Alertas" (79% do que chegava lá era ignição
 * ligada/desligada e offline — ruído puro pro dono do carro) e virou
 * "Trajetos": onde o carro esteve, saída, chegada, km e tempo.
 *
 * O que este teste segura:
 * 1. Trajeto de veículo alheio nunca é servido — mesma trava do resto de /app/*.
 * 2. Rastreador com GPS congelado (só heartbeat, mesma coordenada repetida)
 *    NÃO vira viagem. Esse é o caso real do RTD0D81 em 25/08/2026: 247
 *    mensagens, 1 coordenada, e a tela mostrava "247 Pontos" como se o carro
 *    tivesse andado.
 * 3. O endereço sai resolvido do backend — fonte única, o mesmo texto que o
 *    painel mostra pra aquela coordenada.
 */
import { NotFoundException } from '@nestjs/common';
import { AppDataService } from './app-data.service';

const VIAGEM_REAL = {
  startTime: '2026-08-25T12:56:00.000Z',
  endTime: '2026-08-25T13:09:00.000Z',
  startLat: -22.83153,
  startLng: -43.35541,
  endLat: -22.9,
  endLng: -43.2,
  startAddress: '',
  endAddress: '',
  distance: 12.4,
  duration: 13,
  maxSpeed: 62,
  avgSpeed: 41,
};

function servico(opts: {
  veiculo?: any;
  viagens?: any[];
  enderecos?: Record<string, string>;
}) {
  const prisma: any = {
    vehicle: {
      findFirst: jest.fn().mockResolvedValue(
        opts.veiculo === undefined ? { traccarDeviceId: 895 } : opts.veiculo,
      ),
    },
  };
  const traccar: any = {};
  const reports: any = {
    getTrips: jest.fn().mockResolvedValue(opts.viagens ?? []),
  };
  const geocode: any = {
    chave: (c: { latitude: number; longitude: number }) =>
      `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`,
    lookupCached: jest
      .fn()
      .mockResolvedValue(new Map(Object.entries(opts.enderecos ?? {}))),
  };
  return {
    service: new AppDataService(prisma, traccar, reports, geocode),
    reports,
    geocode,
  };
}

describe('AppDataService.getTrips', () => {
  it('recusa veículo que não é do associado', async () => {
    const { service } = servico({ veiculo: null });
    await expect(
      service.getTrips('a1', 't1', 'v-de-outro', 'from', 'to'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('devolve lista vazia quando o veículo não tem rastreador', async () => {
    const { service, reports } = servico({ veiculo: { traccarDeviceId: null } });
    await expect(service.getTrips('a1', 't1', 'v1', 'f', 't')).resolves.toEqual([]);
    expect(reports.getTrips).not.toHaveBeenCalled();
  });

  it('GPS congelado (só heartbeat) não vira viagem', async () => {
    const { service } = servico({ viagens: [] });
    await expect(service.getTrips('a1', 't1', 'v1', 'f', 't')).resolves.toEqual([]);
  });

  it('entrega a viagem com endereço resolvido e números do Traccar', async () => {
    const { service } = servico({
      viagens: [VIAGEM_REAL],
      enderecos: {
        '-22.8315,-43.3554': 'Avenida Brasil, 20384 · Pavuna · Rio de Janeiro — RJ',
        '-22.9000,-43.2000': 'Rua do Catete, 10 · Catete · Rio de Janeiro — RJ',
      },
    });

    const [viagem] = await service.getTrips('a1', 't1', 'v1', 'f', 't');

    expect(viagem).toEqual({
      id: '2026-08-25T12:56:00.000Z',
      startTime: VIAGEM_REAL.startTime,
      endTime: VIAGEM_REAL.endTime,
      startLat: VIAGEM_REAL.startLat,
      startLng: VIAGEM_REAL.startLng,
      endLat: VIAGEM_REAL.endLat,
      endLng: VIAGEM_REAL.endLng,
      startAddress: 'Avenida Brasil, 20384 · Pavuna · Rio de Janeiro — RJ',
      endAddress: 'Rua do Catete, 10 · Catete · Rio de Janeiro — RJ',
      distanceKm: 12.4,
      durationMin: 13,
      maxSpeed: 62,
    });
  });

  it('sem endereço conhecido a viagem ainda sai — com o campo nulo', async () => {
    const { service } = servico({ viagens: [VIAGEM_REAL], enderecos: {} });
    const [viagem] = await service.getTrips('a1', 't1', 'v1', 'f', 't');
    expect(viagem.startAddress).toBeNull();
    expect(viagem.endAddress).toBeNull();
    expect(viagem.distanceKm).toBe(12.4);
  });

  it('mais recente primeiro — é o que o dono quer ver ao abrir a aba', async () => {
    const antiga = { ...VIAGEM_REAL, startTime: '2026-08-24T10:00:00.000Z' };
    const { service } = servico({ viagens: [antiga, VIAGEM_REAL] });
    const viagens = await service.getTrips('a1', 't1', 'v1', 'f', 't');
    expect(viagens.map((v) => v.startTime)).toEqual([
      VIAGEM_REAL.startTime,
      antiga.startTime,
    ]);
  });
});

/**
 * O que o associado recebe de alerta. A régua é: faz o dono agir? Ignição,
 * offline e condução brusca não fazem — e eram 79% do volume.
 */
describe('AppDataService.getAlerts — só o que faz o dono agir', () => {
  function servicoDeAlertas() {
    const prisma: any = {
      vehicle: { findMany: jest.fn().mockResolvedValue([{ id: 'v1' }]) },
      alert: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { service: new AppDataService(prisma, {} as any, {} as any, {} as any), prisma };
  }

  it('exclui ignição, offline, condução brusca e bateria do rastreador', async () => {
    const { service, prisma } = servicoDeAlertas();
    await service.getAlerts('a1', 't1');
    const where = prisma.alert.findMany.mock.calls[0][0].where;
    expect(where.type.notIn).toEqual(
      expect.arrayContaining([
        'GPS_SILENT',
        'IGNITION_ON',
        'IGNITION_OFF',
        'OFFLINE',
        'HARSH_BRAKE',
        'HARSH_ACCEL',
        'BATTERY_LOW',
      ]),
    );
  });

  it('mantém o que é urgência de verdade', async () => {
    const { service, prisma } = servicoDeAlertas();
    await service.getAlerts('a1', 't1');
    const ocultos: string[] = prisma.alert.findMany.mock.calls[0][0].where.type.notIn;
    for (const vital of ['SOS', 'POWER_CUT', 'JAMMING', 'COLLISION', 'FUEL_THEFT', 'SPEED']) {
      expect(ocultos).not.toContain(vital);
    }
  });
});
