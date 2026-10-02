import { StockTraccarService } from './stock-traccar.service';

/**
 * Rastreador que aponta pro nosso servidor tem que entrar no estoque sozinho.
 *
 * Em 02/10/2026 um lote de 813 J16 chegou de fábrica configurado para o
 * `gps1.trackgo.site`. Ficou dias batendo na porta e o Traccar descartava tudo,
 * porque o IMEI não estava cadastrado — e o log não registra desconhecido, então
 * ninguém via. Só apareceram depois de alguém importar a planilha à mão.
 *
 * Com `database.registerUnknown` ligado no Traccar, o device nasce lá no
 * primeiro pacote. Este job fecha o ciclo: todo device do Traccar que a
 * plataforma não conhece (nem estoque, nem veículo, nem rastreador vinculado)
 * vira item de estoque, pronto pra validar instalação e associar no SGA.
 */

const TENANT = 'b55baec8-c4da-41b7-be9b-9da951710430';

type ItemCriado = {
  tenantId: string;
  imei: string;
  status: string;
  server: string;
  traccarDeviceId: number;
  notes: string;
};

function device(uniqueId: string, id = 900) {
  return {
    id,
    name: uniqueId,
    uniqueId,
    status: 'online',
    lastUpdate: '2026-10-02T16:36:00.000Z',
    positionId: 1,
    groupId: 0,
    phone: '',
    model: '',
    contact: '',
    category: '',
    disabled: false,
    attributes: {} as Record<string, unknown>,
  };
}

function servico(opts: {
  devices: ReturnType<typeof device>[];
  estoque?: string[];
  veiculos?: string[];
  rastreadores?: string[];
  tenants?: string[];
}) {
  const traccar = { getDevices: jest.fn().mockResolvedValue(opts.devices) };
  const prisma = {
    stockItem: {
      findMany: jest
        .fn()
        .mockResolvedValue((opts.estoque ?? []).map((imei) => ({ imei }))),
      create: jest
        .fn()
        .mockImplementation((args: { data: ItemCriado }) => args.data),
    },
    vehicle: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          (opts.veiculos ?? []).map((uniqueId) => ({ uniqueId })),
        ),
    },
    device: {
      findMany: jest
        .fn()
        .mockResolvedValue((opts.rastreadores ?? []).map((imei) => ({ imei }))),
    },
    tenant: {
      findMany: jest
        .fn()
        .mockResolvedValue((opts.tenants ?? [TENANT]).map((id) => ({ id }))),
    },
  };
  const s = new StockTraccarService(
    prisma as never,
    traccar as never,
    {} as never,
  );
  return { s, prisma };
}

describe('StockTraccarService.adotarDesconhecidos', () => {
  it('adota no estoque o IMEI que apareceu no servidor sem cadastro', async () => {
    const { s, prisma } = servico({
      devices: [device('867689065682520', 6082)],
    });

    const adotados = await s.adotarDesconhecidos();

    expect(adotados).toBe(1);
    expect(prisma.stockItem.create).toHaveBeenCalledTimes(1);
    const [{ data }] = prisma.stockItem.create.mock.calls[0] as [
      { data: ItemCriado },
    ];
    expect(data).toMatchObject({
      tenantId: TENANT,
      imei: '867689065682520',
      traccarDeviceId: 6082,
      status: 'ATIVO',
      server: 'gps1',
    });
    expect(data.notes).toMatch(/Entrou sozinho/);
  });

  it('não duplica quem já está no estoque, em veículo ou como rastreador vinculado', async () => {
    const { s, prisma } = servico({
      devices: [
        device('867689066954035', 1),
        device('867689066033707', 2),
        device('867689065741367', 3),
      ],
      estoque: ['867689066954035'],
      veiculos: ['867689066033707'],
      rastreadores: ['867689065741367'],
    });

    expect(await s.adotarDesconhecidos()).toBe(0);
    expect(prisma.stockItem.create).not.toHaveBeenCalled();
  });

  it('ignora identificador que não é IMEI de 15 dígitos', async () => {
    const { s, prisma } = servico({
      devices: [device('DEMO001', 10), device('12345', 11)],
    });

    expect(await s.adotarDesconhecidos()).toBe(0);
    expect(prisma.stockItem.create).not.toHaveBeenCalled();
  });

  it('não adota quando há mais de uma empresa — não dá pra saber de quem é', async () => {
    const { s, prisma } = servico({
      devices: [device('867689065682520', 6082)],
      tenants: [TENANT, '11111111-2222-3333-4444-555555555555'],
    });

    expect(await s.adotarDesconhecidos()).toBe(0);
    expect(prisma.stockItem.create).not.toHaveBeenCalled();
  });

  it('só consulta veículos e rastreadores pelos candidatos, não pela frota inteira', async () => {
    const { s, prisma } = servico({
      devices: [device('867689066954035', 1), device('867689065682520', 2)],
      estoque: ['867689066954035'],
    });

    await s.adotarDesconhecidos();

    expect(prisma.vehicle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          uniqueId: { in: ['867689065682520'] },
        }),
      }),
    );
    expect(prisma.device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ imei: { in: ['867689065682520'] } }),
      }),
    );
  });
});
