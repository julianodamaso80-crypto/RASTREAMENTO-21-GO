import { ClientsService } from './clients.service';

/**
 * Fiação do findAssets com TAG — e o contrato de sigilo: quando o chamador não
 * é time interno (verTags=false), a resposta é EXATAMENTE a de antes, sem
 * nenhum campo de TAG e sem card de "só TAG". Um associado (app) nem passa por
 * este service, mas a régua é testada aqui.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const AGORA = new Date('2026-09-16T18:00:00Z');

const VEICULO = {
  id: 'v1',
  plate: 'CAR1A11',
  brand: 'FIAT',
  model: 'ARGO',
  vehicleType: 'CAR',
  chassi: '9BD000000000001',
  status: 'ACTIVE',
  createdAt: AGORA,
  associate: { id: 'a1', name: 'DONO CARRO', cpf: '11122233344', phone: null, email: null },
  device: { id: 'd1', imei: '860000000000001', model: 'OTHER', status: 'INSTALLED', installedAt: AGORA, installLocation: 'x', lastConnection: AGORA, installedByTechnician: null, installedBy: null },
  hinovaCode: '100',
  sgaStatusLabel: 'ATIVO',
  financialStatus: null,
  financialStatusAt: null,
  appAccessBlocked: false,
};

const LINK = {
  id: 'l1',
  serialNumber: '808092605075275',
  plate: 'MOTO2B22',
  chassi: '9C2KC00000000001',
  hinovaVehicleCode: '200',
  associateName: 'DONO MOTO',
  associateCpf: '55566677788',
  origin: 'REDE',
  verdict: 'CONFIRMADA',
  checkedAt: AGORA,
};

const SGA_MOTO = {
  plate: 'MOTO2B22',
  chassi: '9C2KC00000000001',
  hinovaVehicleCode: '200',
  associateName: 'DONO MOTO SGA',
  cpf: '55566677788',
  phone: '21999990000',
  email: null,
  brandModel: 'HONDA CG 160',
  situationLabel: 'ATIVO',
  vehicleType: 'MOTOCICLETA (ATé 400CC)',
};

function montarPrisma() {
  return {
    vehicle: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockImplementation(({ select }: { select?: unknown }) =>
        // A segunda chamada (só select plate) verifica placas com veículo.
        select ? Promise.resolve([]) : Promise.resolve([VEICULO]),
      ),
    },
    position: { groupBy: jest.fn().mockResolvedValue([]) },
    tagLink: { findMany: jest.fn().mockResolvedValue([LINK]) },
    sgaVehicle: { findMany: jest.fn().mockResolvedValue([SGA_MOTO]) },
    $queryRaw: jest.fn().mockResolvedValue([
      { serial_number: LINK.serialNumber, latitude: -22.7, longitude: -43.3, accuracy_m: 40, seen_at: AGORA },
    ]),
  };
}

describe('findAssets — TAG só para o time interno', () => {
  it('verTags=false devolve a lista antiga, sem TAG e sem card de só-TAG', async () => {
    const prisma = montarPrisma();
    const s = new ClientsService(prisma as never);
    const r = await s.findAssets(TENANT, { verTags: false, perPage: 20 });

    expect(r.data).toHaveLength(1);
    expect(r.data[0].plate).toBe('CAR1A11');
    expect('tag' in r.data[0]).toBe(false);
    expect(r.data[0]).not.toMatchObject({ soTag: true });
    expect(prisma.tagLink.findMany).not.toHaveBeenCalled();
    // Filtro de rastreador de verdade preservado (exclui BLE).
    const where = prisma.vehicle.findMany.mock.calls[0][0].where;
    expect(where.device.is.model.notIn).toEqual(
      expect.arrayContaining(['BLE_KTAG', 'BLE_REDTAG', 'BLE_AIRTAG_GENERIC']),
    );
  });

  it('verTags=true inclui o card de quem só tem TAG, com a última posição', async () => {
    const prisma = montarPrisma();
    const s = new ClientsService(prisma as never);
    const r = await s.findAssets(TENANT, { verTags: true, perPage: 20 });

    expect(r.meta.total).toBe(2); // 1 veículo + 1 só-TAG
    const soTag = r.data.find((a) => (a as { soTag?: boolean }).soTag);
    expect(soTag).toBeDefined();
    expect(soTag).toMatchObject({
      plate: 'MOTO2B22',
      vehicleType: 'MOTORCYCLE',
      device: null,
      tag: { serialNumber: LINK.serialNumber, verdict: 'CONFIRMADA', lat: -22.7 },
    });
    // Situação e nome vêm do espelho do SGA (mais fresco que o vínculo).
    expect(soTag).toMatchObject({ associate: { name: 'DONO MOTO SGA' }, sga: { statusLabel: 'ATIVO' } });
  });

  it('vínculo cujo associado saiu de ATIVO não aparece', async () => {
    const prisma = montarPrisma();
    prisma.sgaVehicle.findMany.mockResolvedValue([{ ...SGA_MOTO, situationLabel: 'INATIVO' }]);
    const s = new ClientsService(prisma as never);
    const r = await s.findAssets(TENANT, { verTags: true, perPage: 20 });
    expect(r.meta.total).toBe(1);
    expect(r.data.some((a) => (a as { soTag?: boolean }).soTag)).toBe(false);
  });

  it('TAG confirmada num carro que JÁ tem rastreador vira selo, não card novo', async () => {
    const prisma = montarPrisma();
    // O vínculo é da mesma placa do veículo com rastreador.
    prisma.tagLink.findMany.mockResolvedValue([{ ...LINK, plate: 'CAR1A11', hinovaVehicleCode: '100' }]);
    prisma.sgaVehicle.findMany.mockResolvedValue([{ ...SGA_MOTO, plate: 'CAR1A11', hinovaVehicleCode: '100' }]);
    prisma.vehicle.findMany.mockImplementation(({ select }: { select?: unknown }) =>
      select ? Promise.resolve([{ plate: 'CAR1A11' }]) : Promise.resolve([VEICULO]),
    );
    const s = new ClientsService(prisma as never);
    const r = await s.findAssets(TENANT, { verTags: true, perPage: 20 });
    expect(r.meta.total).toBe(1);
    const carro = r.data[0] as { plate: string; tag?: { serialNumber: string } };
    expect(carro.plate).toBe('CAR1A11');
    expect(carro.tag?.serialNumber).toBe(LINK.serialNumber);
  });

  it('busca pelo número da TAG acha o carro com rastreador que carrega o selo', async () => {
    const prisma = montarPrisma();
    prisma.tagLink.findMany.mockResolvedValue([{ ...LINK, plate: 'CAR1A11', hinovaVehicleCode: '100' }]);
    prisma.sgaVehicle.findMany.mockResolvedValue([{ ...SGA_MOTO, plate: 'CAR1A11', hinovaVehicleCode: '100' }]);
    prisma.vehicle.findMany.mockImplementation(({ select }: { select?: unknown }) =>
      select ? Promise.resolve([{ plate: 'CAR1A11' }]) : Promise.resolve([VEICULO]),
    );
    const s = new ClientsService(prisma as never);
    await s.findAssets(TENANT, { verTags: true, perPage: 20, search: LINK.serialNumber });

    // O número da TAG não está em campo nenhum do veículo: o carro só entra
    // na busca se a placa dele for acrescentada ao OR.
    const where = prisma.vehicle.count.mock.calls[0][0].where;
    expect(where.OR).toEqual(expect.arrayContaining([{ plate: { in: ['CAR1A11'] } }]));
  });
});
