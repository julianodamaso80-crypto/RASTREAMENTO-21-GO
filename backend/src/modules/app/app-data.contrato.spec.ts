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
  return new AppDataService(prisma, traccar);
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
