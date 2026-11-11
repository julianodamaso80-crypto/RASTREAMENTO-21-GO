import {
  OfflineEquipmentService,
  classificarOffline,
} from './offline-equipment.service';

const MIN = 60 * 1000;
const agora = Date.parse('2026-11-11T12:00:00Z');
const ha = (ms: number) => new Date(agora - ms);

describe('classificarOffline (régua do Mapa)', () => {
  it('conectado até 60 min não entra', () => {
    expect(classificarOffline(ha(10 * MIN), 'CAR', agora)).toBeNull();
    expect(classificarOffline(ha(59 * MIN), 'CAR', agora)).toBeNull();
  });
  it('mais de 60 min é OFFLINE', () => {
    expect(classificarOffline(ha(61 * MIN), 'CAR', agora)).toBe('OFFLINE');
  });
  it('sem comunicação nenhuma é NUNCA_REPORTOU', () => {
    expect(classificarOffline(null, 'CAR', agora)).toBe('NUNCA_REPORTOU');
  });
  it('moto calada há menos de 2 dias é sleep, não offline', () => {
    expect(classificarOffline(ha(300 * MIN), 'MOTORCYCLE', agora)).toBeNull();
    expect(classificarOffline(ha(3 * 24 * 60 * MIN), 'MOTORCYCLE', agora)).toBe(
      'OFFLINE',
    );
  });
});

const veiculo = (plate: string, associate: { name: string } | null = null) => ({
  plate,
  brand: null,
  model: null,
  vehicleType: 'CAR',
  associate,
});

describe('OfflineEquipmentService.listar', () => {
  function montar() {
    const prisma = {
      device: {
        findMany: jest.fn().mockResolvedValue([
          {
            imei: '111',
            lastConnection: null,
            installedAt: new Date('2026-01-01'),
            vehicle: { ...veiculo('AAA1A11', { name: 'Fulano' }), brand: 'Fiat', model: 'Uno' },
          },
          { imei: '222', lastConnection: null, installedAt: null, vehicle: veiculo('BBB2B22') },
          { imei: '333', lastConnection: null, installedAt: null, vehicle: veiculo('CCC3C33') },
        ]),
      },
      stockItem: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { imei: '111', iccid: '8955', line: '2199999', operator: 'Algar' },
          ]),
      },
    };
    const traccar = {
      getDevices: jest.fn().mockResolvedValue([
        { uniqueId: '111', lastUpdate: new Date(Date.now() - 3 * 3600e3).toISOString() },
        { uniqueId: '222', lastUpdate: new Date(Date.now() - 60e3).toISOString() },
      ]),
    };
    return {
      prisma,
      svc: new OfflineEquipmentService(prisma as never, traccar as never),
    };
  }

  it('consulta só INSTALLED com veículo vivo, filtrando por tenant', async () => {
    const { prisma, svc } = montar();
    await svc.listar('t1');
    const where = prisma.device.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      tenantId: 't1',
      deletedAt: null,
      status: 'INSTALLED',
    });
    expect(where.vehicle).toBeDefined();
    expect(prisma.stockItem.findMany.mock.calls[0][0].where.tenantId).toBe('t1');
  });

  it('casa o chip por IMEI e classifica conforme a régua', async () => {
    const { svc } = montar();
    const r = await svc.listar('t1');
    expect(r.meta.total).toBe(2);
    const a = r.data.find((x) => x.imei === '111')!;
    expect(a).toMatchObject({
      placa: 'AAA1A11',
      modeloVeiculo: 'Fiat Uno',
      cliente: 'Fulano',
      iccid: '8955',
      numeroChip: '2199999',
      operadora: 'Algar',
      situacao: 'OFFLINE',
    });
    // 222 comunicou há 1 min: fora. 333 nunca apareceu no Traccar: dentro.
    expect(r.data.find((x) => x.imei === '222')).toBeUndefined();
    const c = r.data.find((x) => x.imei === '333')!;
    expect(c.situacao).toBe('NUNCA_REPORTOU');
    expect(c.iccid).toBeNull();
  });
});
