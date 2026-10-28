/**
 * /app/vehicles consulta no Traccar só os devices dos veículos do associado.
 * Autorização: A nunca vê veículo, posição ou device de B; sem veículo não há
 * chamada; sem contexto de associado é 401, nunca a frota. Equivalência: para
 * os mesmos dados, a resposta é idêntica à montagem antiga (frota inteira +
 * filtro em memória).
 */
import { UnauthorizedException } from '@nestjs/common';
import { AppDataService } from './app-data.service';
import { TraccarService } from '../traccar/traccar.service';

type V = {
  id: string;
  plate: string;
  vehicleType: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  status: string;
  traccarDeviceId: number | null;
  blockerAccessAllowed: boolean;
  associateId: string | null;
  tenantId: string;
  deletedAt: Date | null;
};

function veiculo(p: Partial<V> & Pick<V, 'id' | 'plate'>): V {
  return {
    vehicleType: 'CAR',
    brand: 'Fiat',
    model: 'Argo',
    color: 'Prata',
    year: 2022,
    status: 'ACTIVE',
    traccarDeviceId: null,
    blockerAccessAllowed: false,
    associateId: 'A',
    tenantId: 't1',
    deletedAt: null,
    ...p,
  };
}

const BANCO: V[] = [
  veiculo({ id: 'a1', plate: 'AAA1A11', traccarDeviceId: 11, blockerAccessAllowed: true }),
  veiculo({ id: 'a2', plate: 'AAA2A22', traccarDeviceId: 12, vehicleType: 'MOTORCYCLE' }),
  veiculo({ id: 'a3', plate: 'AAA3A33', traccarDeviceId: null }), // sem rastreador
  veiculo({ id: 'a4', plate: 'AAA4A44', traccarDeviceId: 13 }), // device inexistente no Traccar
  veiculo({ id: 'a5', plate: 'AAA5A55', traccarDeviceId: 11 }), // mesmo device de a1
  veiculo({ id: 'a6', plate: 'AAA6A66', traccarDeviceId: 14 }), // device sem vínculo ao usuário da sessão
  veiculo({ id: 'a7', plate: 'AAA7A77', traccarDeviceId: 15, deletedAt: new Date() }), // apagado
  veiculo({ id: 'b1', plate: 'BBB1B11', traccarDeviceId: 21, associateId: 'B' }),
  veiculo({ id: 'x1', plate: 'XXX1X11', traccarDeviceId: 31, associateId: 'A', tenantId: 't2' }),
  veiculo({ id: 'z1', plate: 'ZZZ1Z11', traccarDeviceId: 41, associateId: 'Z' }),
];

const pos = (deviceId: number, extra: Record<string, unknown> = {}) => ({
  id: deviceId * 100,
  deviceId,
  latitude: -22.9 - deviceId / 1000,
  longitude: -43.2,
  speed: 10 + deviceId,
  course: 90,
  fixTime: '2026-10-14T12:00:00.000Z',
  address: null,
  attributes: { ignition: true, power: 12.6, sat: 9, totalDistance: 123456 },
  ...extra,
});
const dev = (id: number) => ({
  id,
  positionId: id * 100,
  status: 'online',
  lastUpdate: '2026-10-14T12:00:05.000Z',
});

// Traccar simulado. "Vinculados" ao usuário da sessão: o que `/devices` e
// `/positions` sem filtro devolvem. Por id o admin enxerga também o 14.
const VINCULADOS = [11, 12, 15, 21, 31, 41];
const POSICOES = [11, 12, 14, 15, 21, 31, 41].map((d) => pos(d));
const DEVICES = [11, 12, 14, 15, 21, 31, 41].map(dev);

function montar(opts: { traccarDevolveAMais?: boolean; porDevice?: boolean } = {}) {
  const findMany = jest.fn(async ({ where }: { where: Partial<V> }) =>
    BANCO.filter(
      (v) =>
        (where.associateId === undefined || v.associateId === where.associateId) &&
        (where.tenantId === undefined || v.tenantId === where.tenantId) &&
        (where.deletedAt === undefined || v.deletedAt === where.deletedAt),
    )
      .sort((x, y) => x.plate.localeCompare(y.plate))
      .map(({ associateId: _a, tenantId: _t, deletedAt: _d, ...sel }) => sel),
  );
  const prisma: any = { vehicle: { findMany }, sgaVehicle: { findMany: jest.fn().mockResolvedValue([]) }, };
  const traccar = {
    getPositions: jest.fn(async () => POSICOES.filter((p) => VINCULADOS.includes(p.deviceId))),
    getDevices: jest.fn(async () => DEVICES.filter((d) => VINCULADOS.includes(d.id))),
    // Como o TraccarService: posição pelo positionId dos devices recebidos.
    getPositionsDosDevices: jest.fn(async (ids: number[], devices: { positionId: number }[]) =>
      opts.traccarDevolveAMais
        ? POSICOES
        : POSICOES.filter(
            (p) => ids.includes(p.deviceId) && devices.some((d) => d.positionId === p.id),
          ),
    ),
    getDevicesPorIds: jest.fn(async (ids: number[]) =>
      opts.traccarDevolveAMais
        ? DEVICES
        : DEVICES.filter((d) => ids.includes(d.id) && VINCULADOS.includes(d.id)),
    ),
  };
  // A flag é lida no construtor.
  const antes = process.env.APP_VEHICLES_POR_DEVICE;
  process.env.APP_VEHICLES_POR_DEVICE = (opts.porDevice ?? true) ? '1' : '';
  const service = new AppDataService(prisma, traccar as any, {} as any, {} as any);
  if (antes === undefined) delete process.env.APP_VEHICLES_POR_DEVICE;
  else process.env.APP_VEHICLES_POR_DEVICE = antes;
  return { service, traccar, findMany };
}

/** Montagem de antes desta mudança: frota inteira do Traccar + filtro em memória. */
async function montagemAntiga(associateId: string, tenantId: string) {
  const { service, traccar, findMany } = montar({ porDevice: false });
  const vehicles: any[] = await findMany({ where: { associateId, tenantId, deletedAt: null } });
  const comDevice = vehicles.filter((v) => v.traccarDeviceId !== null);
  // Reaproveita os DTOs reais: o serviço com um único veículo sem device
  // devolve exatamente toVehicleDto + position/connection null.
  const semDevice = async (v: any) => {
    findMany.mockResolvedValueOnce([v]);
    return (await service.getVehicles(associateId, tenantId))[0];
  };
  if (comDevice.length === 0) return Promise.all(vehicles.map(semDevice));
  const [positions, devices] = await Promise.all([traccar.getPositions(), traccar.getDevices()]);
  const posByDevice = new Map(positions.map((p) => [p.deviceId, p]));
  const devByDevice = new Map(devices.map((d) => [d.id, d]));
  const KNOTS_TO_KMH = 1.852;
  return Promise.all(
    vehicles.map(async (v) => {
      const base = await semDevice({ ...v });
      const p: any = v.traccarDeviceId ? posByDevice.get(v.traccarDeviceId) : undefined;
      const d: any = v.traccarDeviceId ? devByDevice.get(v.traccarDeviceId) : undefined;
      const a = p?.attributes ?? {};
      return {
        ...base,
        position: p
          ? {
              latitude: p.latitude,
              longitude: p.longitude,
              speed: Math.round(p.speed * KNOTS_TO_KMH),
              course: p.course,
              address: p.address ?? null,
              fixTime: p.fixTime,
              ignition: a.ignition ?? null,
              motion: a.motion ?? null,
              battery: a.batteryLevel ?? null,
              voltage: a.power ?? null,
              satellites: a.sat ?? a.satellites ?? null,
              odometer: a.totalDistance != null ? Math.round(a.totalDistance / 1000) : null,
              powerCut: a.powerCut ?? null,
              blocked: a.blocked ?? null,
            }
          : null,
        connection: d ? { status: d.status, lastUpdate: d.lastUpdate } : null,
      };
    }),
  );
}

describe('/app/vehicles com APP_VEHICLES_POR_DEVICE ligada — autorização', () => {
  it('A vê só os próprios veículos vivos do próprio tenant', async () => {
    const { service } = montar();
    const r = await service.getVehicles('A', 't1');
    expect(r.map((v) => v.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  });

  it('os ids enviados ao Traccar são exatamente os devices dos veículos de A', async () => {
    const { service, traccar } = montar();
    await service.getVehicles('A', 't1');
    // Repetição (dois veículos no mesmo device) o TraccarService já elimina.
    const pedidos = [
      ...new Set(traccar.getPositionsDosDevices.mock.calls[0][0]),
    ].sort((x, y) => x - y);
    expect(pedidos).toEqual([11, 12, 13, 14]);
    expect(traccar.getDevicesPorIds.mock.calls[0][0]).toEqual(
      traccar.getPositionsDosDevices.mock.calls[0][0],
    );
    // A posição sai dos devices já buscados (positionId), sem segunda ida a /devices.
    expect(traccar.getDevicesPorIds).toHaveBeenCalledTimes(1);
    expect(traccar.getPositionsDosDevices.mock.calls[0][1]).toEqual(
      await traccar.getDevicesPorIds.mock.results[0].value,
    );
  });

  it('com o TraccarService real: lista em `id`, nenhum `deviceId`, posição para cada veículo', async () => {
    const { findMany } = montar();
    const real = new TraccarService({ get: () => 'http://traccar.local' } as never);
    const urls: string[] = [];
    jest
      .spyOn((real as unknown as { client: { get: (u: string) => Promise<unknown> } }).client, 'get')
      .mockImplementation(async (url: string) => {
        urls.push(url);
        const [rota, query = ''] = url.split('?');
        const q = new URLSearchParams(query);
        // Como o Traccar: `deviceId` é um só (repetido, vale o primeiro).
        if (q.has('deviceId')) {
          return { data: POSICOES.filter((p) => p.deviceId === Number(q.get('deviceId'))) };
        }
        const ids = q.getAll('id').map(Number);
        if (rota === '/devices') return { data: DEVICES.filter((d) => ids.includes(d.id)) };
        return { data: POSICOES.filter((p) => ids.includes(p.id)) };
      });
    const antes = process.env.APP_VEHICLES_POR_DEVICE;
    process.env.APP_VEHICLES_POR_DEVICE = '1';
    const service = new AppDataService({ vehicle: { findMany }, sgaVehicle: { findMany: jest.fn().mockResolvedValue([]) }, } as any, real as any, {} as any, {} as any);
    if (antes === undefined) delete process.env.APP_VEHICLES_POR_DEVICE;
    else process.env.APP_VEHICLES_POR_DEVICE = antes;

    const r = await service.getVehicles('A', 't1');
    const porId = Object.fromEntries(r.map((v) => [v.id, v]));
    expect(porId.a1.position?.latitude).toBe(pos(11).latitude);
    expect(porId.a2.position?.latitude).toBe(pos(12).latitude);
    expect(porId.a3.position).toBeNull();
    expect(porId.a4.position).toBeNull();
    for (const u of urls) expect(u).not.toContain('deviceId');
    expect(urls.filter((u) => u.startsWith('/devices?'))).toHaveLength(1);
    const posUrl = urls.find((u) => u.startsWith('/positions?'))!;
    expect(
      new URLSearchParams(posUrl.split('?')[1]).getAll('id').map(Number).sort((x, y) => x - y),
    ).toEqual([1100, 1200, 1400]);
  });

  it('frota inteira do Traccar nunca é consultada', async () => {
    const { service, traccar } = montar();
    await service.getVehicles('A', 't1');
    await service.getVehicles('B', 't1');
    expect(traccar.getPositions).not.toHaveBeenCalled();
    expect(traccar.getDevices).not.toHaveBeenCalled();
  });

  it('Traccar devolvendo posição e device de B a mais: nada de B chega a A', async () => {
    const { service } = montar({ traccarDevolveAMais: true });
    const r = await service.getVehicles('A', 't1');
    expect(r.map((v) => v.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    const s = JSON.stringify(r);
    for (const deB of ['b1', 'BBB1B11', String(pos(21).latitude), String(pos(31).latitude)]) {
      expect(s).not.toContain(deB);
    }
  });

  it('associado sem veículos → [] e Traccar não é chamado', async () => {
    const { service, traccar } = montar();
    await expect(service.getVehicles('SEM', 't1')).resolves.toEqual([]);
    expect(traccar.getPositionsDosDevices).not.toHaveBeenCalled();
    expect(traccar.getDevicesPorIds).not.toHaveBeenCalled();
    expect(traccar.getPositions).not.toHaveBeenCalled();
    expect(traccar.getDevices).not.toHaveBeenCalled();
  });

  it('veículos sem rastreador → position/connection null e Traccar não é chamado', async () => {
    const { service, traccar, findMany } = montar();
    findMany.mockResolvedValueOnce([
      { ...veiculo({ id: 'a3', plate: 'AAA3A33' }), traccarDeviceId: null },
    ]);
    const r = await service.getVehicles('A', 't1');
    expect(r[0]).toMatchObject({ id: 'a3', position: null, connection: null });
    expect(traccar.getPositionsDosDevices).not.toHaveBeenCalled();
    expect(traccar.getDevicesPorIds).not.toHaveBeenCalled();
  });

  it('outro tenant com o mesmo associateId → só os veículos daquele tenant', async () => {
    const { service } = montar();
    expect((await service.getVehicles('A', 't2')).map((v) => v.id)).toEqual(['x1']);
    expect(await service.getVehicles('B', 't2')).toEqual([]);
  });

  it.each([
    [undefined, 't1', true],
    ['A', undefined, true],
    [undefined, undefined, true],
    ['', 't1', true],
    ['A', '', true],
    [undefined, 't1', false],
    ['A', undefined, false],
    ['', '', false],
  ])(
    'sem contexto de associado (%p, %p), flag %p → 401, sem tocar banco nem Traccar',
    async (associateId, tenantId, porDevice) => {
      const { service, traccar, findMany } = montar({ porDevice });
      await expect(
        service.getVehicles(associateId as any, tenantId as any),
      ).rejects.toThrow(UnauthorizedException);
      expect(findMany).not.toHaveBeenCalled();
      expect(traccar.getPositionsDosDevices).not.toHaveBeenCalled();
      expect(traccar.getPositions).not.toHaveBeenCalled();
      expect(traccar.getDevices).not.toHaveBeenCalled();
    },
  );

  it('falha do Traccar → erro, sem cair para a frota inteira', async () => {
    const { service, traccar } = montar();
    traccar.getPositionsDosDevices.mockRejectedValueOnce(new Error('traccar fora'));
    await expect(service.getVehicles('A', 't1')).rejects.toThrow('traccar fora');
    expect(traccar.getPositions).not.toHaveBeenCalled();
    expect(traccar.getDevices).not.toHaveBeenCalled();
  });
});

describe('/app/vehicles — mesma resposta da montagem antiga', () => {
  it.each([
    ['A', 't1', true],
    ['B', 't1', true],
    ['A', 't2', true],
    ['SEM', 't1', true],
    ['A', 't1', false],
    ['B', 't1', false],
    ['A', 't2', false],
    ['SEM', 't1', false],
  ])('associado %s / tenant %s, flag %p: JSON idêntico', async (associateId, tenantId, porDevice) => {
    const antiga = await montagemAntiga(associateId, tenantId);
    const { service } = montar({ porDevice });
    const nova = await service.getVehicles(associateId, tenantId);
    expect(JSON.stringify(nova)).toBe(JSON.stringify(antiga));
  });

  it('cenário A cobre os casos de borda (sem device, inexistente, compartilhado, sem vínculo)', async () => {
    const { service } = montar();
    const r = await service.getVehicles('A', 't1');
    const porId = Object.fromEntries(r.map((v) => [v.id, v]));
    expect(porId.a1.position).not.toBeNull();
    expect(porId.a5.position).toEqual(porId.a1.position);
    expect(porId.a3).toMatchObject({ position: null, connection: null });
    expect(porId.a4).toMatchObject({ position: null, connection: null });
    expect(porId.a6).toMatchObject({ position: null, connection: null });
  });
});

describe('/app/vehicles com APP_VEHICLES_POR_DEVICE desligada (padrão) — caminho de hoje', () => {
  it.each([[undefined], [''], ['0'], ['false'], ['sim']])(
    'flag %p → frota inteira via getPositions()/getDevices(), nada por id',
    async (valor) => {
      const antes = process.env.APP_VEHICLES_POR_DEVICE;
      if (valor === undefined) delete process.env.APP_VEHICLES_POR_DEVICE;
      else process.env.APP_VEHICLES_POR_DEVICE = valor;
      const { traccar, findMany } = montar();
      // montar() liga a flag; aqui o serviço é criado com o valor do teste.
      const service = new AppDataService(
        { vehicle: { findMany }, sgaVehicle: { findMany: jest.fn().mockResolvedValue([]) }, } as any,
        traccar as any,
        {} as any,
        {} as any,
      );
      if (antes === undefined) delete process.env.APP_VEHICLES_POR_DEVICE;
      else process.env.APP_VEHICLES_POR_DEVICE = antes;

      const r = await service.getVehicles('A', 't1');
      expect(r.map((v) => v.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
      expect(traccar.getPositions).toHaveBeenCalledTimes(1);
      expect(traccar.getPositions).toHaveBeenCalledWith();
      expect(traccar.getDevices).toHaveBeenCalledTimes(1);
      expect(traccar.getDevices).toHaveBeenCalledWith();
      expect(traccar.getPositionsDosDevices).not.toHaveBeenCalled();
      expect(traccar.getDevicesPorIds).not.toHaveBeenCalled();
    },
  );

  it.each([['1'], ['true'], [' TRUE ']])('flag %p liga o caminho por id', async (valor) => {
    const antes = process.env.APP_VEHICLES_POR_DEVICE;
    process.env.APP_VEHICLES_POR_DEVICE = valor;
    const { traccar, findMany } = montar();
    const service = new AppDataService({ vehicle: { findMany }, sgaVehicle: { findMany: jest.fn().mockResolvedValue([]) }, } as any, traccar as any, {} as any, {} as any);
    if (antes === undefined) delete process.env.APP_VEHICLES_POR_DEVICE;
    else process.env.APP_VEHICLES_POR_DEVICE = antes;
    await service.getVehicles('A', 't1');
    expect(traccar.getPositionsDosDevices).toHaveBeenCalledTimes(1);
    expect(traccar.getPositions).not.toHaveBeenCalled();
  });

  it('associado sem veículos → [] e Traccar não é chamado (como hoje)', async () => {
    const { service, traccar } = montar({ porDevice: false });
    await expect(service.getVehicles('SEM', 't1')).resolves.toEqual([]);
    expect(traccar.getPositions).not.toHaveBeenCalled();
    expect(traccar.getDevices).not.toHaveBeenCalled();
  });

  it('Traccar devolve a frota com B: nada de B chega a A', async () => {
    const { service } = montar({ porDevice: false });
    const s = JSON.stringify(await service.getVehicles('A', 't1'));
    for (const deB of ['b1', 'BBB1B11', String(pos(21).latitude), String(pos(31).latitude)]) {
      expect(s).not.toContain(deB);
    }
  });
});
