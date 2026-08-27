/**
 * Regra absoluta (dono, 21/08/2026): função de time interno NUNCA chega ao
 * associado. IMEI + local de instalação é mapa pra sabotagem. O `select` do
 * Prisma protege hoje, mas um `...spread` no serviço faria qualquer coluna nova
 * vazar — este teste simula o Prisma devolvendo o registro gordo e exige que
 * a resposta continue enxuta.
 */
import { AppDataService } from './app-data.service';
import { AssociateAuthService } from './associate-auth.service';

const PROIBIDOS = [
  'imei',
  'installLocation',
  'installedAt',
  'technicianId',
  'technician',
  'serialNumber',
  'stockItemId',
  'stockItem',
  'device',
  'deviceId',
];

const veiculoGordo = {
  id: 'v1',
  plate: 'ABC1D23',
  vehicleType: 'CAR',
  brand: 'Fiat',
  model: 'Argo',
  color: 'Prata',
  year: 2022,
  status: 'ACTIVE',
  traccarDeviceId: 7,
  // tudo abaixo é interno e não pode sair
  imei: '860000000000001',
  installLocation: 'Atrás do painel, lado esquerdo',
  installedAt: new Date(),
  technicianId: 't1',
  technician: { name: 'Fulano' },
  serialNumber: 'SN1',
  stockItemId: 's1',
  device: { imei: '860000000000001' },
  deviceId: 'd1',
};

function servico(vehicles: any[]) {
  const prisma: any = {
    vehicle: { findMany: jest.fn().mockResolvedValue(vehicles) },
    alert: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const traccar: any = {
    getPositions: jest.fn().mockResolvedValue([]),
    getDevices: jest.fn().mockResolvedValue([]),
  };
  return new AppDataService(prisma, traccar, {} as any, {} as any);
}

function chaves(obj: any): string[] {
  return Object.keys(obj ?? {});
}

describe('contrato do associado — /app/vehicles', () => {
  it('com rastreador vinculado, nenhum campo interno sai na resposta', async () => {
    const r = await servico([veiculoGordo]).getVehicles('a1', 'tn1');
    for (const k of PROIBIDOS) expect(chaves(r[0])).not.toContain(k);
    expect(chaves(r[0]).sort()).toEqual(
      ['brand', 'color', 'connection', 'id', 'model', 'plate', 'position', 'status', 'traccarDeviceId', 'vehicleType', 'year'].sort(),
    );
  });

  it('sem rastreador vinculado (traccarDeviceId null), idem', async () => {
    const r = await servico([{ ...veiculoGordo, traccarDeviceId: null }]).getVehicles('a1', 'tn1');
    for (const k of PROIBIDOS) expect(chaves(r[0])).not.toContain(k);
    expect(chaves(r[0]).sort()).toEqual(
      ['brand', 'color', 'connection', 'id', 'model', 'plate', 'position', 'status', 'traccarDeviceId', 'vehicleType', 'year'].sort(),
    );
  });
});

describe('contrato do associado — /app/alerts', () => {
  const alertaGordo = {
    id: 'al1',
    type: 'SOS',
    severity: 'HIGH',
    message: 'Botão de pânico acionado',
    status: 'OPEN',
    read: false,
    createdAt: new Date(),
    // tudo abaixo é interno e não pode sair
    imei: '860000000000001',
    technicianId: 't1',
    internalNotes: 'cliente já foi avisado por telefone',
    vehicle: {
      id: 'v1',
      plate: 'ABC1D23',
      // tudo abaixo é interno e não pode sair
      imei: '860000000000001',
      installLocation: 'Atrás do painel, lado esquerdo',
    },
  };

  function servicoComAlerta(alerta: any) {
    const prisma: any = {
      vehicle: { findMany: jest.fn().mockResolvedValue([{ id: 'v1' }]) },
      alert: { findMany: jest.fn().mockResolvedValue([alerta]) },
    };
    const traccar: any = {
      getPositions: jest.fn().mockResolvedValue([]),
      getDevices: jest.fn().mockResolvedValue([]),
    };
    return new AppDataService(prisma, traccar, {} as any, {} as any);
  }

  it('nenhum campo interno sai na resposta, nem no alerta nem no veículo aninhado', async () => {
    const r = await servicoComAlerta(alertaGordo).getAlerts('a1', 'tn1');
    for (const k of ['imei', 'technicianId', 'internalNotes', 'installLocation']) {
      expect(chaves(r[0])).not.toContain(k);
      expect(chaves(r[0].vehicle)).not.toContain(k);
    }
    expect(chaves(r[0]).sort()).toEqual(
      ['id', 'type', 'severity', 'message', 'status', 'read', 'createdAt', 'vehicle'].sort(),
    );
    expect(chaves(r[0].vehicle).sort()).toEqual(['id', 'plate'].sort());
  });

  it('não expõe alertas técnicos internos (GPS_SILENT) ao associado', async () => {
    const prisma: any = {
      vehicle: { findMany: jest.fn().mockResolvedValue([{ id: 'v1' }]) },
      alert: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const traccar: any = {
      getPositions: jest.fn().mockResolvedValue([]),
      getDevices: jest.fn().mockResolvedValue([]),
    };
    await new AppDataService(prisma, traccar, {} as any, {} as any).getAlerts('a1', 'tn1');
    const where = prisma.alert.findMany.mock.calls[0][0].where;
    // A lista completa do que é escondido vive em app-trajetos.spec.ts; aqui o
    // que importa é que o alerta técnico interno nunca sai por /app/*.
    expect(where.type.notIn).toContain('GPS_SILENT');
  });
});

describe('contrato do associado — /app/auth/login', () => {
  const CPF = '08577590780';

  const associadoGordo = {
    id: 'a1',
    name: 'Fulano',
    cpf: CPF,
    email: 'fulano@example.com',
    phone: '5511999998888',
    tenantId: 'tn1',
    password: null,
    mustChangePassword: true,
    // tudo abaixo é interno e não pode sair
    internalNotes: 'cliente difícil, cobrar com cuidado',
    allowedIps: ['1.2.3.4'],
    role: 'ADMIN',
    technicianId: 't1',
  };

  function servicoLogin(associado: any) {
    const prisma: any = {
      associate: {
        findMany: jest.fn().mockResolvedValue([associado]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      device: { count: jest.fn().mockResolvedValue(1) },
    };
    const jwt: any = { sign: jest.fn().mockReturnValue('tok') };
    const whatsapp: any = {};
    return new AssociateAuthService(prisma, jwt, whatsapp);
  }

  beforeEach(() => {
    delete process.env.APP_ASSOCIATE_ALLOWLIST;
  });

  it('a resposta do login traz só os campos do contrato do associado, nada de interno', async () => {
    const r = await servicoLogin(associadoGordo).login({
      cpf: CPF,
      password: CPF,
    });

    expect(chaves(r.associate).sort()).toEqual(
      ['id', 'name', 'cpf', 'email', 'phone', 'tenantId', 'mustChangePassword'].sort(),
    );
    for (const k of ['password', 'internalNotes', 'allowedIps', 'role', 'technicianId']) {
      expect(chaves(r.associate)).not.toContain(k);
    }
  });
});

describe('contrato do associado — /app/me', () => {
  const meGordo = {
    id: 'a1',
    name: 'Fulano',
    cpf: '08577590780',
    email: 'fulano@example.com',
    phone: '5511999998888',
    tenantId: 'tn1',
    mustChangePassword: false,
    // tudo abaixo é interno e não pode sair
    password: 'hash-secreto',
    internalNotes: 'cliente difícil, cobrar com cuidado',
    allowedIps: ['1.2.3.4'],
    tenant: {
      id: 'tn1',
      name: '21 GO',
      logoUrl: null,
      primaryColor: '#123456',
      // tudo abaixo é interno e não pode sair
      apiSecret: 'segredo-do-tenant',
    },
    _count: { vehicles: 2 },
  };

  function servicoMe(associado: any) {
    const prisma: any = {
      associate: { findFirst: jest.fn().mockResolvedValue(associado) },
    };
    const jwt: any = { sign: jest.fn().mockReturnValue('tok') };
    const whatsapp: any = {};
    return new AssociateAuthService(prisma, jwt, whatsapp);
  }

  it('nenhum campo interno sai na resposta, nem no topo nem no tenant aninhado', async () => {
    const r = await servicoMe(meGordo).me('a1');
    for (const k of ['password', 'internalNotes', 'allowedIps']) {
      expect(chaves(r)).not.toContain(k);
    }
    expect(chaves((r as any).tenant)).not.toContain('apiSecret');
    expect(chaves(r).sort()).toEqual(
      ['id', 'name', 'cpf', 'email', 'phone', 'tenantId', 'mustChangePassword', 'tenant', '_count'].sort(),
    );
    expect(chaves((r as any).tenant).sort()).toEqual(
      ['id', 'name', 'logoUrl', 'primaryColor'].sort(),
    );
  });
});
