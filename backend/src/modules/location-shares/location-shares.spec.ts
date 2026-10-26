import {
  BadRequestException,
  GoneException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { LocationSharesService, linkDaLocalizacao } from './location-shares.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const VEICULO = '22222222-2222-2222-2222-222222222222';
const TOKEN = 'a'.repeat(43);

function servico() {
  const prisma = {
    vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
    locationShare: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }) => ({ id: 'x', revokedAt: null, createdAt: new Date(), ...data })),
      update: jest.fn(),
    },
  };
  const traccar = {
    getDevicesPorIds: jest.fn().mockResolvedValue([{ id: 7, lastUpdate: '2026-10-26T18:00:00Z' }]),
    getPositionsDosDevices: jest.fn().mockResolvedValue([
      {
        deviceId: 7,
        latitude: -22.9,
        longitude: -43.2,
        speed: 10,
        course: 90,
        fixTime: '2026-10-26T18:00:00Z',
        attributes: { ignition: true },
      },
    ]),
  };
  const geocode = { lookupNow: jest.fn().mockResolvedValue('Rua A, Rio de Janeiro') };
  const s = new LocationSharesService(prisma as never, traccar as never, geocode as never);
  return { s, prisma, traccar };
}

const registro = (extra: Record<string, unknown> = {}) => ({
  id: 'r1',
  tenantId: TENANT,
  vehicleId: VEICULO,
  plate: 'ABC1D23',
  hours: 8,
  source: 'PAINEL',
  requestedByName: 'Operador',
  token: TOKEN,
  expiresAt: new Date(Date.now() + 3_600_000),
  revokedAt: null,
  createdAt: new Date(),
  ...extra,
});

describe('LocationSharesService', () => {
  it('só aceita as durações do botão', async () => {
    const { s, prisma } = servico();
    await expect(
      s.criar(TENANT, VEICULO, 5, { origem: 'PAINEL' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vehicle.findFirst).not.toHaveBeenCalled();
  });

  it('associado só gera link do próprio veículo', async () => {
    const { s, prisma } = servico();
    await expect(
      s.criar(TENANT, VEICULO, 8, { origem: 'APP', associateId: 'assoc-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.vehicle.findFirst.mock.calls[0][0].where).toMatchObject({
      id: VEICULO,
      tenantId: TENANT,
      associateId: 'assoc-1',
    });
  });

  it('associado sem identificação não chega ao banco', async () => {
    const { s, prisma } = servico();
    await expect(s.criar(TENANT, VEICULO, 8, { origem: 'APP' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.vehicle.findFirst).not.toHaveBeenCalled();
  });

  it('gera link com prazo das horas escolhidas e código aleatório', async () => {
    const { s, prisma } = servico();
    prisma.vehicle.findFirst.mockResolvedValue({ id: VEICULO, plate: 'ABC1D23', traccarDeviceId: 7 });
    const antes = Date.now();
    const r = await s.criar(TENANT, VEICULO, 24, { origem: 'PAINEL', nome: 'Op' });
    const data = prisma.locationShare.create.mock.calls[0][0].data;
    expect(data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.expiresAt.getTime() - antes).toBeGreaterThanOrEqual(24 * 3_600_000 - 1000);
    expect(r.url).toBe(linkDaLocalizacao(data.token));
    expect(r.active).toBe(true);
  });

  it('público: código fora do formato não consulta o banco', async () => {
    const { s, prisma } = servico();
    await expect(s.publico('../etc')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.locationShare.findFirst).not.toHaveBeenCalled();
  });

  it('público: link vencido ou cancelado responde 410', async () => {
    const { s, prisma } = servico();
    prisma.locationShare.findFirst.mockResolvedValueOnce(registro({ expiresAt: new Date(Date.now() - 1) }));
    await expect(s.publico(TOKEN)).rejects.toBeInstanceOf(GoneException);
    prisma.locationShare.findFirst.mockResolvedValueOnce(registro({ revokedAt: new Date() }));
    await expect(s.publico(TOKEN)).rejects.toBeInstanceOf(GoneException);
  });

  it('público: devolve posição sem dados do dono', async () => {
    const { s, prisma } = servico();
    prisma.locationShare.findFirst.mockResolvedValue(registro());
    prisma.vehicle.findFirst.mockResolvedValue({
      plate: 'ABC1D23',
      brand: 'Fiat',
      model: 'Uno',
      color: 'Branco',
      vehicleType: 'CAR',
      traccarDeviceId: 7,
    });
    const r = await s.publico(TOKEN);
    expect(prisma.vehicle.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: TENANT });
    expect(r.position).toMatchObject({ latitude: -22.9, longitude: -43.2, speed: 19, address: 'Rua A, Rio de Janeiro' });
    expect(Object.keys(r)).not.toContain('associate');
    expect(JSON.stringify(r)).not.toContain('Operador');
  });

  it('público: link do associado para de abrir quando o veículo troca de dono', async () => {
    const { s, prisma, traccar } = servico();
    prisma.locationShare.findFirst.mockResolvedValue(
      registro({ source: 'APP', requestedByAssociateId: 'assoc-antigo' }),
    );
    prisma.vehicle.findFirst.mockResolvedValue({
      plate: 'ABC1D23',
      vehicleType: 'CAR',
      traccarDeviceId: 7,
      associateId: 'assoc-novo',
    });
    await expect(s.publico(TOKEN)).rejects.toBeInstanceOf(GoneException);
    expect(traccar.getPositionsDosDevices).not.toHaveBeenCalled();
  });

  it('associado só cancela link que ele mesmo gerou', async () => {
    const { s, prisma } = servico();
    await expect(
      s.cancelar(TENANT, 'r1', { origem: 'APP', associateId: 'assoc-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.locationShare.findFirst.mock.calls[0][0].where).toMatchObject({
      tenantId: TENANT,
      requestedByAssociateId: 'assoc-1',
    });
  });
});
