import { BleTagsService } from './ble-tags.service';

describe('BleTagsService.createSighting', () => {
  const device = {
    id: 'dev-1',
    imei: '92603008494',
    model: 'BLE_KTAG',
    vehicleId: 'veh-1',
  };

  function montarService() {
    const sightingCriado: any[] = [];
    const deviceAtualizado: any[] = [];
    const prisma: any = {
      device: {
        findFirst: jest.fn().mockResolvedValue(device),
        update: jest.fn((args) => {
          deviceAtualizado.push(args);
          return Promise.resolve(device);
        }),
      },
      bleSighting: {
        create: jest.fn((args) => {
          sightingCriado.push(args);
          return Promise.resolve({ id: 'sig-1', ...args.data });
        }),
      },
    };
    return {
      service: new BleTagsService(prisma),
      sightingCriado,
      deviceAtualizado,
    };
  }

  it('aceita relatorio da rede Apple, que nao tem rssi', async () => {
    const { service, sightingCriado } = montarService();
    const visto = new Date('2026-08-20T10:00:00.000Z');

    await service.createSighting(
      {
        deviceImei: '92603008494',
        macAddress: 'EB:25:02:3C:02:0E',
        seenAt: visto.toISOString(),
        accuracy: 40,
        scannerLat: -22.9,
        scannerLng: -43.2,
        scannerSource: 'apple-findmy',
      } as any,
      'tenant-1',
    );

    expect(sightingCriado[0].data.rssi).toBeNull();
    expect(sightingCriado[0].data.accuracy).toBe(40);
    expect(sightingCriado[0].data.seenAt).toEqual(visto);
  });

  it('usa o momento atual como seenAt quando o scanner local nao informa', async () => {
    const { service, sightingCriado } = montarService();
    const antes = Date.now();

    await service.createSighting(
      {
        deviceImei: '92603008494',
        macAddress: 'EB:25:02:3C:02:0E',
        rssi: -55,
        scannerSource: 'ble-local',
      } as any,
      'tenant-1',
    );

    const gravado = sightingCriado[0].data.seenAt.getTime();
    expect(gravado).toBeGreaterThanOrEqual(antes);
    expect(sightingCriado[0].data.rssi).toBe(-55);
  });

  it('marca lastConnection com o momento em que a TAG foi vista, nao com o de gravacao', async () => {
    const { service, deviceAtualizado } = montarService();
    const visto = new Date('2026-08-20T08:00:00.000Z');

    await service.createSighting(
      {
        deviceImei: '92603008494',
        macAddress: 'EB:25:02:3C:02:0E',
        seenAt: visto.toISOString(),
        scannerSource: 'apple-findmy',
      } as any,
      'tenant-1',
    );

    expect(deviceAtualizado[0].data.lastConnection).toEqual(visto);
  });
});

describe('BleTagsService - ordenacao pelo momento em que a TAG foi vista', () => {
  const device = {
    id: 'dev-1',
    imei: '92603008494',
    model: 'BLE_KTAG',
    vehicleId: 'veh-1',
  };

  it('findAll pede ao Prisma o sighting atual ordenado por seenAt desc, nao createdAt', async () => {
    const findManyArgs: any[] = [];
    const prisma: any = {
      device: {
        findMany: jest.fn((args) => {
          findManyArgs.push(args);
          return Promise.resolve([]);
        }),
      },
    };
    const service = new BleTagsService(prisma);

    await service.findAll('tenant-1');

    expect(findManyArgs[0].include.bleSightings.orderBy).toEqual({
      seenAt: 'desc',
    });
  });

  it('listSightings pede ao Prisma o historico ordenado por seenAt desc, nao createdAt', async () => {
    const findManyArgs: any[] = [];
    const prisma: any = {
      device: {
        findFirst: jest.fn().mockResolvedValue(device),
      },
      bleSighting: {
        findMany: jest.fn((args) => {
          findManyArgs.push(args);
          return Promise.resolve([]);
        }),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new BleTagsService(prisma);

    await service.listSightings('dev-1', 'tenant-1', { page: 1, perPage: 10 } as any);

    expect(findManyArgs[0].orderBy).toEqual({ seenAt: 'desc' });
  });
});

describe('BleTagsService.getPollingPlan', () => {
  const AGORA = new Date('2026-08-20T12:00:00.000Z');

  function montarService(devices: any[], alertas: any[] = []) {
    const chamadas: any = {};
    const prisma: any = {
      device: {
        findMany: jest.fn((args) => {
          chamadas.device = args;
          return Promise.resolve(devices);
        }),
      },
      alert: {
        findMany: jest.fn((args) => {
          chamadas.alert = args;
          return Promise.resolve(alertas);
        }),
      },
    };
    return { service: new BleTagsService(prisma), chamadas };
  }

  const tagComChave = {
    imei: '92603008494',
    vehicleId: 'veh-1',
    bleAdvKeyPrivate: 'priv',
    bleAdvKeyHashed: 'hash',
    bleTurboUntil: null,
  };

  it('devolve a TAG em IDLE quando o veiculo nao tem alerta de rastreador mudo', async () => {
    const { service } = montarService([tagComChave]);
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags).toHaveLength(1);
    expect(plano.tags[0].mode).toBe('IDLE');
    expect(plano.tags[0].privateKey).toBe('priv');
  });

  it('acelera a TAG do veiculo cujo rastreador esta sob jamming', async () => {
    const { service } = montarService(
      [tagComChave],
      [{ vehicleId: 'veh-1', type: 'JAMMING' }],
    );
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags[0].mode).toBe('TURBO');
    expect(plano.tags[0].backfillHours).toBe(168);
  });

  it('nao acelera uma TAG por causa de alerta de outro veiculo', async () => {
    const { service } = montarService(
      [tagComChave],
      [{ vehicleId: 'veh-OUTRO', type: 'JAMMING' }],
    );
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags[0].mode).toBe('IDLE');
  });

  it('ignora TAG sem chave cadastrada, que o worker nao teria como consultar', async () => {
    const { service } = montarService([
      { ...tagComChave, bleAdvKeyPrivate: null },
    ]);
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags).toHaveLength(0);
  });

  it('filtra por tenant e por soft delete nas duas consultas', async () => {
    const { service, chamadas } = montarService([tagComChave]);
    await service.getPollingPlan('tenant-1', AGORA);

    expect(chamadas.device.where.tenantId).toBe('tenant-1');
    expect(chamadas.device.where.deletedAt).toBeNull();
    expect(chamadas.alert.where.tenantId).toBe('tenant-1');
  });

  it('nao devolve tenantId no corpo, para nao existir caminho de escrita cruzada', async () => {
    const { service } = montarService([tagComChave]);
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags[0]).not.toHaveProperty('tenantId');
  });
});
