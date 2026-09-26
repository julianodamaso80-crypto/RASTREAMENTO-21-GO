/**
 * Bloqueio pelo próprio associado (24/09/2026): só com o "acesso ao
 * bloqueador" liberado pelo admin, conferido na hora da chamada.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppDataService } from './app-data.service';

function servico(veiculo: any, traccarStatus: 'ok' | 'fila' | 'erro' = 'ok') {
  const prisma: any = {
    vehicle: {
      findFirst: jest.fn().mockResolvedValue(veiculo),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const traccar: any = {
    sendCommandNow:
      traccarStatus === 'erro'
        ? jest.fn().mockRejectedValue(new Error('timeout'))
        : jest.fn().mockResolvedValue({ enviado: traccarStatus === 'ok' }),
  };
  return { svc: new AppDataService(prisma, traccar, {} as any, {} as any), prisma, traccar };
}

const liberado = {
  id: 'v1',
  traccarDeviceId: 1457,
  blockerAccessAllowed: true,
  appAccessBlocked: false,
};

describe('bloqueio pelo associado', () => {
  it('liberado: envia engineStop e marca BLOCKED', async () => {
    const { svc, prisma, traccar } = servico(liberado);
    const r = await svc.setBlocked('a1', 'tn1', 'v1', true);
    expect(traccar.sendCommandNow).toHaveBeenCalledWith(1457, 'engineStop');
    expect(prisma.vehicle.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { status: 'BLOCKED' },
    });
    expect(r).toEqual({ status: 'BLOCKED', queued: false });
  });

  it('desbloquear envia engineResume e volta a ACTIVE', async () => {
    const { svc, traccar } = servico(liberado);
    const r = await svc.setBlocked('a1', 'tn1', 'v1', false);
    expect(traccar.sendCommandNow).toHaveBeenCalledWith(1457, 'engineResume');
    expect(r.status).toBe('ACTIVE');
  });

  it('só procura veículo do próprio associado e tenant', async () => {
    const { svc, prisma } = servico(liberado);
    await svc.setBlocked('a1', 'tn1', 'v1', true);
    expect(prisma.vehicle.findFirst.mock.calls[0][0].where).toEqual({
      id: 'v1',
      associateId: 'a1',
      tenantId: 'tn1',
      deletedAt: null,
    });
  });

  it('rastreador offline: comando na fila → queued true', async () => {
    const { svc } = servico(liberado, 'fila');
    expect(await svc.setBlocked('a1', 'tn1', 'v1', true)).toEqual({
      status: 'BLOCKED',
      queued: true,
    });
  });

  it('sem liberação: 403 e nenhum comando', async () => {
    const { svc, traccar } = servico({ ...liberado, blockerAccessAllowed: false });
    await expect(svc.setBlocked('a1', 'tn1', 'v1', true)).rejects.toBeInstanceOf(ForbiddenException);
    expect(traccar.sendCommandNow).not.toHaveBeenCalled();
  });

  it('veículo de outro associado: 404', async () => {
    const { svc } = servico(null);
    await expect(svc.setBlocked('a1', 'tn1', 'v9', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('acesso do cliente cortado: 404', async () => {
    const { svc } = servico({ ...liberado, appAccessBlocked: true });
    await expect(svc.setBlocked('a1', 'tn1', 'v1', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sem rastreador: 400', async () => {
    const { svc } = servico({ ...liberado, traccarDeviceId: null });
    await expect(svc.setBlocked('a1', 'tn1', 'v1', true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Traccar falhou: 503 e status não muda', async () => {
    const { svc, prisma } = servico(liberado, 'erro');
    await expect(svc.setBlocked('a1', 'tn1', 'v1', true)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.vehicle.update).not.toHaveBeenCalled();
  });
});
