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
