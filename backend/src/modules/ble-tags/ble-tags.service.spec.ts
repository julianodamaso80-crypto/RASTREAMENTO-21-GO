import { BleTagsService } from './ble-tags.service';

describe('BleTagsService.createSighting', () => {
  const device = {
    id: 'dev-1',
    imei: '92603008494',
    model: 'BLE_KTAG',
    vehicleId: 'veh-1',
  };

  function montarService(deviceOverride: any = device, sightingExistente: any = null) {
    const sightingCriado: any[] = [];
    const deviceAtualizado: any[] = [];
    const prisma: any = {
      device: {
        findFirst: jest.fn().mockResolvedValue(deviceOverride),
        update: jest.fn((args) => {
          deviceAtualizado.push(args);
          return Promise.resolve(deviceOverride);
        }),
      },
      bleSighting: {
        findFirst: jest.fn().mockResolvedValue(sightingExistente),
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
      prisma,
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

  it('nao deixa lastConnection andar pra tras num backfill fora de ordem (I2)', async () => {
    const deviceComConexaoRecente = {
      ...device,
      lastConnection: new Date('2026-08-20T12:00:00.000Z'),
    };
    const { service, deviceAtualizado } = montarService(deviceComConexaoRecente);
    const vistoNoPassado = new Date('2026-08-14T08:00:00.000Z'); // 6 dias antes

    await service.createSighting(
      {
        deviceImei: '92603008494',
        macAddress: 'EB:25:02:3C:02:0E',
        seenAt: vistoNoPassado.toISOString(),
        scannerSource: 'apple-findmy',
      } as any,
      'tenant-1',
    );

    expect(deviceAtualizado).toHaveLength(0);
  });

  it('duplicidade de reenvio (restart do worker em backfill) devolve o mesmo sighting, sem criar de novo (I3)', async () => {
    const sightingExistente = { id: 'sig-ja-existe' };
    const { service, sightingCriado, prisma } = montarService(device, sightingExistente);

    const resultado = await service.createSighting(
      {
        deviceImei: '92603008494',
        macAddress: 'EB:25:02:3C:02:0E',
        seenAt: '2026-08-20T10:00:00.000Z',
        hashedAdvKey: 'hash-abc',
        scannerSource: 'apple-findmy',
      } as any,
      'tenant-1',
    );

    expect(resultado).toBe(sightingExistente);
    expect(sightingCriado).toHaveLength(0);
    expect(prisma.bleSighting.findFirst).toHaveBeenCalledWith({
      where: {
        deviceId: 'dev-1',
        hashedAdvKey: 'hash-abc',
        seenAt: new Date('2026-08-20T10:00:00.000Z'),
      },
    });
  });

  it('sem hashedAdvKey (scanner local antigo) nao tenta o dedupe, so cria', async () => {
    const { service, sightingCriado, prisma } = montarService();

    await service.createSighting(
      {
        deviceImei: '92603008494',
        macAddress: 'EB:25:02:3C:02:0E',
        rssi: -60,
        scannerSource: 'ble-local',
      } as any,
      'tenant-1',
    );

    expect(prisma.bleSighting.findFirst).not.toHaveBeenCalled();
    expect(sightingCriado).toHaveLength(1);
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

  it('findAll pede ao Prisma pra omitir a chave privada da TAG, que nunca pode voltar em listagem (C3)', async () => {
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

    expect(findManyArgs[0].omit).toEqual({
      bleAdvKeyPrivate: true,
      bleAdvKeyHashed: true,
    });
  });

  it('findOne pede ao Prisma pra omitir a chave privada da TAG, que nunca pode voltar no detalhe (C3)', async () => {
    const findFirstArgs: any[] = [];
    const prisma: any = {
      device: {
        findFirst: jest.fn((args) => {
          findFirstArgs.push(args);
          return Promise.resolve(device);
        }),
      },
    };
    const service = new BleTagsService(prisma);

    await service.findOne('dev-1', 'tenant-1');

    expect(findFirstArgs[0].omit).toEqual({
      bleAdvKeyPrivate: true,
      bleAdvKeyHashed: true,
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

  it('nao devolve a TAG em repouso: sem ocorrencia aberta, o worker nao a consulta', async () => {
    const { service } = montarService([tagComChave]);
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags).toHaveLength(0);
  });

  it.each(['OFFLINE', 'GPS_SILENT', 'JAMMING', 'POWER_CUT'])(
    'acelera a TAG do veiculo cujo rastreador esta com alerta %s: entra no plano em TURBO, 30min, backfill de 7 dias',
    async (alerta) => {
      const { service } = montarService(
        [tagComChave],
        [{ vehicleId: 'veh-1', type: alerta }],
      );
      const plano = await service.getPollingPlan('tenant-1', AGORA);

      expect(plano.tags).toHaveLength(1);
      expect(plano.tags[0].mode).toBe('TURBO');
      expect(plano.tags[0].intervalSeconds).toBe(1800);
      expect(plano.tags[0].backfillHours).toBe(168);
      expect(plano.tags[0].privateKey).toBe('priv');
    },
  );

  it('nao acelera uma TAG por causa de alerta de outro veiculo, e como fica IDLE nem entra no plano', async () => {
    const { service } = montarService(
      [tagComChave],
      [{ vehicleId: 'veh-OUTRO', type: 'JAMMING' }],
    );
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags).toHaveLength(0);
  });

  it('entra no plano com uma TAG do acionamento manual ainda valido', async () => {
    const { service } = montarService([
      { ...tagComChave, bleTurboUntil: new Date('2026-08-20T12:00:01.000Z') },
    ]);
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags).toHaveLength(1);
    expect(plano.tags[0].mode).toBe('TURBO');
    expect(plano.tags[0].intervalSeconds).toBe(1800);
  });

  it('nao entra no plano quando o acionamento manual ja expirou', async () => {
    const { service } = montarService([
      { ...tagComChave, bleTurboUntil: new Date('2026-08-20T11:59:59.000Z') },
    ]);
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags).toHaveLength(0);
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
    const { service } = montarService(
      [tagComChave],
      [{ vehicleId: 'veh-1', type: 'JAMMING' }],
    );
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags[0]).not.toHaveProperty('tenantId');
  });
});

describe('BleTagsService.acionarTurbo', () => {
  const AGORA = new Date('2026-08-20T12:00:00.000Z');

  it('liga o ritmo acelerado por 6 horas a partir de agora', async () => {
    const atualizacoes: any[] = [];
    const prisma: any = {
      device: {
        findFirst: jest.fn().mockResolvedValue({ id: 'dev-1', model: 'BLE_KTAG' }),
        update: jest.fn((args) => {
          atualizacoes.push(args);
          return Promise.resolve({ ...args.data });
        }),
      },
    };
    const service = new BleTagsService(prisma);

    const r = await service.acionarTurbo('dev-1', 'tenant-1', AGORA);

    expect(r.bleTurboUntil).toEqual(new Date('2026-08-20T18:00:00.000Z'));
    expect(atualizacoes[0].where.id).toBe('dev-1');
  });

  it('recusa TAG de outro tenant', async () => {
    const prisma: any = {
      device: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const service = new BleTagsService(prisma);

    await expect(
      service.acionarTurbo('dev-1', 'tenant-INTRUSO', AGORA),
    ).rejects.toThrow('TAG BLE não encontrada');
    expect(prisma.device.update).not.toHaveBeenCalled();
  });
});
