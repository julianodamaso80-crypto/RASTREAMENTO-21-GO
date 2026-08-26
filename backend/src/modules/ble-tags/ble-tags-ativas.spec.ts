import { BleTagsService } from './ble-tags.service';

/**
 * "TAG ativa" é a régua do dono: vinculada a um veículo e em uso.
 *
 * Quem sabe isso é o SGA (`codigo_tipo_adesao` 8 = rastreador+TAG, 9 = só TAG),
 * não o nosso cadastro de equipamento: a TAG só vira `Device` aqui quando
 * alguém a cadastra com número e MAC, e listar por esse cadastro mostrava zero
 * enquanto o SGA tinha ~9,7 mil ativos.
 */
const TENANT = '11111111-1111-1111-1111-111111111111';

function montar(rows: any[] = [], veiculos: any[] = []) {
  const findManyArgs: any[] = [];
  const countArgs: any[] = [];
  const vehicleArgs: any[] = [];
  const prisma: any = {
    sgaVehicle: {
      findMany: jest.fn((args) => {
        findManyArgs.push(args);
        return Promise.resolve(rows);
      }),
      count: jest.fn((args) => {
        countArgs.push(args);
        return Promise.resolve(rows.length);
      }),
    },
    vehicle: {
      findMany: jest.fn((args) => {
        vehicleArgs.push(args);
        return Promise.resolve(veiculos);
      }),
    },
  };
  return {
    service: new BleTagsService(prisma),
    findManyArgs,
    countArgs,
    vehicleArgs,
  };
}

const linhaSga = (over: any = {}) => ({
  id: 's1',
  plate: 'RIZ3B88',
  chassi: null,
  brandModel: 'HONDA CG 160',
  associateName: 'LUIZ FERNANDO',
  cpf: '10286114712',
  phone: null,
  adhesionCode: '8',
  contractDate: new Date('2026-08-14T00:00:00.000Z'),
  hinovaVehicleCode: '123',
  ...over,
});

describe('BleTagsService.findActive', () => {
  it('só conta quem tem TAG no SGA e está com cliente ATIVO', async () => {
    const { service, findManyArgs } = montar();

    await service.findActive(TENANT);

    const where = findManyArgs[0].where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.situationLabel).toBe('ATIVO');
    expect(where.adhesionCode).toEqual({ in: ['8', '9'] });
  });

  it('o filtro por tipo separa rastreador+TAG de só TAG', async () => {
    const { service, findManyArgs } = montar();

    await service.findActive(TENANT, { tipo: 'SO_TAG' });

    expect(findManyArgs[0].where.adhesionCode).toBe('9');
  });

  it('pagina de verdade — não traz a base inteira pra tela', async () => {
    const { service, findManyArgs } = montar();

    await service.findActive(TENANT, { page: 3, perPage: 20 });

    expect(findManyArgs[0].skip).toBe(40);
    expect(findManyArgs[0].take).toBe(20);
  });

  it('cruza só as placas da página com o nosso cadastro', async () => {
    const { service, vehicleArgs } = montar([
      linhaSga(),
      linhaSga({ id: 's2', plate: 'KXW8940' }),
    ]);

    await service.findActive(TENANT);

    expect(vehicleArgs[0].where.plate).toEqual({
      in: ['RIZ3B88', 'KXW8940'],
    });
  });

  it('mostra número e MAC quando a TAG também está cadastrada aqui', async () => {
    const { service } = montar(
      [linhaSga()],
      [
        {
          id: 'v1',
          plate: 'RIZ3B88',
          device: {
            id: 'd1',
            imei: '92603008494',
            model: 'BLE_KTAG',
            brand: 'TrackerKing',
            deletedAt: null,
            bleSightings: [
              {
                macAddress: 'EB:25:02:3C:02:0E',
                seenAt: new Date('2026-08-25T10:00:00.000Z'),
              },
            ],
          },
        },
      ],
    );

    const r = await service.findActive(TENANT);

    expect(r.data[0].tag).toEqual({
      id: 'd1',
      imei: '92603008494',
      model: 'BLE_KTAG',
      brand: 'TrackerKing',
      macAddress: 'EB:25:02:3C:02:0E',
      lastSeenAt: '2026-08-25T10:00:00.000Z',
    });
    expect(r.data[0].vehicleId).toBe('v1');
  });

  it('rastreador GPS no veículo não vira TAG cadastrada', async () => {
    const { service } = montar(
      [linhaSga()],
      [
        {
          id: 'v1',
          plate: 'RIZ3B88',
          device: {
            id: 'd1',
            imei: '866557084674045',
            model: 'J16',
            brand: null,
            deletedAt: null,
            bleSightings: [],
          },
        },
      ],
    );

    const r = await service.findActive(TENANT);

    // O veículo é nosso, mas o equipamento é GPS: a TAG segue desconhecida.
    expect(r.data[0].vehicleId).toBe('v1');
    expect(r.data[0].tag).toBeNull();
  });

  it('buscar por nome não pode trazer a base inteira de volta', async () => {
    const { service, findManyArgs } = montar();

    await service.findActive(TENANT, { search: 'AURELIO' });

    const or = findManyArgs[0].where.OR;
    // `contains: ''` casa com tudo — o CPF só entra quando o termo tem
    // dígitos suficientes pra ser documento.
    expect(or.some((c: any) => c.cpf)).toBe(false);
    expect(or.some((c: any) => c.associateName?.contains === 'AURELIO')).toBe(true);
  });

  it('pedaço numérico de placa não vira busca por CPF', async () => {
    const { service, findManyArgs } = montar();

    await service.findActive(TENANT, { search: 'LTG2D32' });

    const or = findManyArgs[0].where.OR;
    expect(or.some((c: any) => c.cpf)).toBe(false);
    expect(or.some((c: any) => c.plate?.contains === 'LTG2D32')).toBe(true);
  });

  it('CPF inteiro continua buscando por documento', async () => {
    const { service, findManyArgs } = montar();

    await service.findActive(TENANT, { search: '047.724.477-76' });

    const or = findManyArgs[0].where.OR;
    expect(or.some((c: any) => c.cpf?.contains === '04772447776')).toBe(true);
  });

  it('traduz o código do SGA pro que a tela mostra', async () => {
    const { service } = montar([
      linhaSga(),
      linhaSga({ id: 's2', plate: 'KXW8940', adhesionCode: '9' }),
    ]);

    const r = await service.findActive(TENANT);

    expect(r.data.map((x: any) => x.tipo)).toEqual([
      'RASTREADOR_E_TAG',
      'SO_TAG',
    ]);
  });
});

/**
 * A posição que aparece no card é a do RASTREADOR do veículo — a TAG não
 * reporta sozinha. Se o servidor GPS cair, a lista continua de pé sem posição:
 * é melhor mostrar o cliente sem localização do que uma tela de erro.
 */
describe('BleTagsService.findActive — última posição', () => {
  function montarComTraccar(posicoes: any[], falha = false) {
    const prisma: any = {
      sgaVehicle: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 's1',
            plate: 'RIZ3B88',
            chassi: null,
            brandModel: 'HONDA CG 160',
            associateName: 'LUIZ FERNANDO',
            cpf: null,
            phone: null,
            adhesionCode: '8',
            contractDate: null,
            hinovaVehicleCode: '1',
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      vehicle: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'v1', plate: 'RIZ3B88', traccarDeviceId: 936, device: null },
        ]),
      },
    };
    const traccar: any = {
      getPositions: jest.fn(() =>
        falha ? Promise.reject(new Error('offline')) : Promise.resolve(posicoes),
      ),
    };
    return new BleTagsService(prisma, traccar);
  }

  const agora = new Date().toISOString();

  it('traz a posição do rastreador do veículo', async () => {
    const service = montarComTraccar([
      {
        deviceId: 936,
        latitude: -22.88,
        longitude: -43.63,
        fixTime: agora,
        address: 'Rua 23',
        speed: 0,
        valid: true,
      },
    ]);

    const r = await service.findActive(TENANT);

    expect(r.data[0].ultimaPosicao).toMatchObject({
      latitude: -22.88,
      longitude: -43.63,
      address: 'Rua 23',
      confiavel: true,
    });
  });

  it('ignora posição de outro veículo', async () => {
    const service = montarComTraccar([
      { deviceId: 999, latitude: -1, longitude: -1, fixTime: agora, valid: true },
    ]);

    const r = await service.findActive(TENANT);

    expect(r.data[0].ultimaPosicao).toBeNull();
  });

  it('servidor GPS fora do ar não derruba a lista', async () => {
    const service = montarComTraccar([], true);

    const r = await service.findActive(TENANT);

    expect(r.data).toHaveLength(1);
    expect(r.data[0].ultimaPosicao).toBeNull();
  });
});
