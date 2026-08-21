import { DevicesService } from './devices.service';

// A chave privada da TAG BLE (bleAdvKeyPrivate/bleAdvKeyHashed) nunca pode
// voltar em listagem, detalhe ou exclusão de dispositivo — só sai do banco
// pela rota de plano de polling do módulo ble-tags. Ver C3.
describe('DevicesService - omissao da chave privada da TAG BLE (C3)', () => {
  const OMIT_ESPERADO = {
    bleAdvKeyPrivate: true,
    bleAdvKeyHashed: true,
  };

  const device = {
    id: 'dev-1',
    imei: '92603008494',
    model: 'BLE_KTAG',
    vehicleId: null,
    deletedAt: null,
  };

  function montarService() {
    const findManyArgs: any[] = [];
    const findFirstArgs: any[] = [];
    const updateArgs: any[] = [];
    const prisma: any = {
      device: {
        findMany: jest.fn((args) => {
          findManyArgs.push(args);
          return Promise.resolve([]);
        }),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn((args) => {
          findFirstArgs.push(args);
          return Promise.resolve(device);
        }),
        update: jest.fn((args) => {
          updateArgs.push(args);
          return Promise.resolve(device);
        }),
      },
    };
    const traccarService: any = {};
    const deviceRegistry: any = { notifyDeviceChanged: jest.fn() };
    const service = new DevicesService(prisma, traccarService, deviceRegistry);
    return { service, findManyArgs, findFirstArgs, updateArgs };
  }

  it('findAll pede ao Prisma pra omitir a chave privada', async () => {
    const { service, findManyArgs } = montarService();

    await service.findAll('tenant-1', { page: 1, perPage: 10 } as any);

    expect(findManyArgs[0].omit).toEqual(OMIT_ESPERADO);
  });

  it('findOne pede ao Prisma pra omitir a chave privada', async () => {
    const { service, findFirstArgs } = montarService();

    await service.findOne('dev-1', 'tenant-1');

    expect(findFirstArgs[0].omit).toEqual(OMIT_ESPERADO);
  });

  it('remove (exclusao) pede ao Prisma pra omitir a chave privada no retorno do update', async () => {
    const { service, updateArgs } = montarService();

    await service.remove('dev-1', 'tenant-1');

    expect(updateArgs[0].omit).toEqual(OMIT_ESPERADO);
  });
});
