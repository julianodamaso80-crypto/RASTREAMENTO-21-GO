import { Prisma } from '.prisma/client';
import { DevicesService } from './devices.service';

/**
 * O ciclo "cliente cancelou → aparelho volta pro estoque → aparelho é
 * instalado em outro veículo" só fecha se o desvínculo soltar TUDO que prende
 * o rastreador ao dono antigo. Cada teste aqui é um desses vínculos.
 */
const IMEI = '866557084663055';
const TRACCAR_ID = 42;
const TENANT = '11111111-1111-1111-1111-111111111111';

const DEVICE = {
  id: 'dev-1',
  imei: IMEI,
  vehicleId: 'veh-1',
  traccarDeviceId: TRACCAR_ID,
  deletedAt: null,
};

function montar() {
  const tx = {
    device: { update: jest.fn().mockResolvedValue(DEVICE) },
    vehicle: { update: jest.fn().mockResolvedValue({ id: 'veh-1' }) },
    stockItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma: any = {
    device: { findFirst: jest.fn().mockResolvedValue(DEVICE) },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  // O Traccar devolve o device inteiro no GET e exige o objeto inteiro no PUT.
  const traccar: any = {
    getDevice: jest.fn().mockResolvedValue({
      id: TRACCAR_ID,
      name: 'ADW0Z41',
      uniqueId: IMEI,
      disabled: false,
      category: 'car',
    }),
    updateDevice: jest.fn().mockResolvedValue({}),
  };
  const registry: any = { notifyDeviceChanged: jest.fn() };
  const service = new DevicesService(prisma, traccar, registry);
  return { service, tx, traccar, registry };
}

describe('DevicesService.uninstall — o que o desvínculo precisa soltar', () => {
  it('libera o unique_id do veículo, senão o mesmo IMEI não instala em outra placa', async () => {
    const { service, tx } = montar();

    await service.uninstall('dev-1', TENANT, { reason: 'cliente cancelou' });

    expect(tx.vehicle.update).toHaveBeenCalledWith({
      where: { id: 'veh-1' },
      data: { traccarDeviceId: null, uniqueId: 'RETIRADO-veh-1' },
    });
  });

  it('solta o rastreador do veículo e carimba o motivo no histórico', async () => {
    const { service, tx } = montar();

    await service.uninstall('dev-1', TENANT, {
      reason: 'cliente cancelou',
      by: 'operador@21go',
    });

    const data = tx.device.update.mock.calls[0][0].data;
    expect(data.vehicleId).toBeNull();
    expect(data.status).toBe('DEACTIVATED');
    expect(data.uninstallReason).toBe('cliente cancelou');
    expect(data.uninstalledBy).toBe('operador@21go');
  });

  it('religa o device no servidor GPS e devolve o nome pro IMEI', async () => {
    const { service, traccar } = montar();

    await service.uninstall('dev-1', TENANT);

    // `disabled: true` fazia o Traccar recusar a sessão do rastreador
    // (ConnectionManager.getDeviceSession → Device.checkDisabled), ou seja: o
    // aparelho voltava pro estoque cego. E o nome tem que voltar a ser o IMEI,
    // que é como o estoque cadastra e reconhece o equipamento.
    //
    // O payload leva o device inteiro de propósito: o PUT do Traccar troca o
    // registro todo e recusa (400) um corpo sem `uniqueId`. Foi assim que a
    // primeira versão desta correção falhou no ensaio local.
    expect(traccar.updateDevice).toHaveBeenCalledWith(TRACCAR_ID, {
      id: TRACCAR_ID,
      name: IMEI,
      uniqueId: IMEI,
      disabled: false,
      category: 'car',
    });
  });

  it('devolve o item ao estoque disponível guardando o id do Traccar', async () => {
    const { service, tx } = montar();

    await service.uninstall('dev-1', TENANT);

    const chamada = tx.stockItem.updateMany.mock.calls[0][0];
    expect(chamada.where).toEqual({ tenantId: TENANT, imei: IMEI });
    expect(chamada.data).toMatchObject({
      associatedAt: null,
      deviceId: null,
      traccarDeviceId: TRACCAR_ID,
    });
  });

  it('não quebra o desvínculo quando o servidor GPS está fora', async () => {
    const { service, tx, traccar } = montar();
    traccar.getDevice.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.uninstall('dev-1', TENANT)).resolves.toBeDefined();
    expect(tx.stockItem.updateMany).toHaveBeenCalled();
  });

  it('apaga o selo de conferência da instalação anterior', async () => {
    const { service, tx } = montar();

    await service.uninstall('dev-1', TENANT);

    // O selo diz "este aparelho foi conferido no ato da instalação". Voltando
    // pro estoque com o selo do ciclo passado, o operador acha que o
    // equipamento que ficou meses num carro já foi testado — e ele não foi.
    expect(tx.stockItem.updateMany.mock.calls[0][0].data).toMatchObject({
      validatedAt: null,
      validatedById: null,
      validatedByName: null,
      validationOk: null,
      validationNotes: null,
      // Coluna Json: zerar de verdade é `DbNull`, não o literal JSON `null`.
      validationSnapshot: Prisma.DbNull,
    });
  });
});
