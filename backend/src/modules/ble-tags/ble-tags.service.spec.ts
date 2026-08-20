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
