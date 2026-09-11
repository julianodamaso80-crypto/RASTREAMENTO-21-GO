import { UnprocessableEntityException } from '@nestjs/common';
import { StockService } from './stock.service';

/**
 * Bloqueio/desbloqueio de TESTE no rastreador do estoque, antes de ter placa.
 *
 * O que este arquivo protege: o Traccar guarda na fila o comando pra aparelho
 * desconectado e entrega quando ele volta a falar. Um bloqueio de bancada que
 * ficasse na fila cortaria o carro do cliente dias depois, já instalado.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const IMEI = '866557086326644';
const DEVICE_ID = 4321;

function servico(opcoes: {
  statusNoTraccar?: string;
  saiNaHora?: boolean;
  associadoEm?: Date | null;
  resposta?: string | null;
}) {
  const prisma = {
    stockItem: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'item-1',
        imei: IMEI,
        traccarDeviceId: DEVICE_ID,
        associatedAt: opcoes.associadoEm ?? null,
      }),
    },
  };
  const traccar = {
    getDevice: jest
      .fn()
      .mockResolvedValue({ id: DEVICE_ID, status: opcoes.statusNoTraccar ?? 'online' }),
    sendCommandNow: jest
      .fn()
      .mockResolvedValue({ enviado: opcoes.saiNaHora ?? true }),
    sendCommand: jest.fn().mockResolvedValue({}),
    aguardarRespostaDeComando: jest
      .fn()
      .mockResolvedValue(opcoes.resposta ?? null),
  };
  const stockTraccar = {
    ensureDevice: jest.fn().mockResolvedValue(DEVICE_ID),
  };

  const s = new StockService(
    prisma as never,
    {} as never,
    traccar as never,
    {} as never,
    {} as never,
    stockTraccar as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { s, prisma, traccar };
}

describe('StockService.comandoDeTeste — liga/desliga sem placa', () => {
  it('bloqueia o rastreador conectado e devolve a resposta dele', async () => {
    const { s, traccar } = servico({
      resposta: 'Cut off the fuel supply: Success!',
    });

    const r = await s.comandoDeTeste('item-1', TENANT, 'block');

    expect(traccar.sendCommandNow).toHaveBeenCalledWith(DEVICE_ID, 'engineStop');
    expect(r).toEqual({
      imei: IMEI,
      comando: 'block',
      enviado: true,
      resposta: 'Cut off the fuel supply: Success!',
    });
  });

  it('procura o item só dentro do tenant', async () => {
    const { s, prisma } = servico({});
    await s.comandoDeTeste('item-1', TENANT, 'unblock');
    expect(prisma.stockItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'item-1', tenantId: TENANT, deletedAt: null }),
      }),
    );
  });

  it('recusa bloquear rastreador desconectado — nem manda o comando', async () => {
    const { s, traccar } = servico({ statusNoTraccar: 'offline' });

    await expect(s.comandoDeTeste('item-1', TENANT, 'block')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(traccar.sendCommandNow).not.toHaveBeenCalled();
    expect(traccar.sendCommand).not.toHaveBeenCalled();
  });

  it('status "unknown" do Traccar também não conta como conectado', async () => {
    const { s, traccar } = servico({ statusNoTraccar: 'unknown' });

    await expect(s.comandoDeTeste('item-1', TENANT, 'block')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(traccar.sendCommandNow).not.toHaveBeenCalled();
  });

  it('bloqueio que caiu na fila ganha um desbloqueio logo atrás', async () => {
    // Desconectou entre a checagem e o envio: o Traccar respondeu 202.
    const { s, traccar } = servico({ saiNaHora: false });

    await expect(s.comandoDeTeste('item-1', TENANT, 'block')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(traccar.sendCommand).toHaveBeenCalledWith(DEVICE_ID, 'engineResume');
  });

  it('desbloqueio pode ficar na fila: devolver o aparelho liberado é sempre seguro', async () => {
    const { s, traccar } = servico({ statusNoTraccar: 'offline', saiNaHora: false });

    const r = await s.comandoDeTeste('item-1', TENANT, 'unblock');

    expect(traccar.sendCommandNow).toHaveBeenCalledWith(DEVICE_ID, 'engineResume');
    expect(traccar.aguardarRespostaDeComando).not.toHaveBeenCalled();
    expect(r).toEqual({ imei: IMEI, comando: 'unblock', enviado: false, resposta: null });
  });

  it('rastreador já instalado num veículo não passa por aqui', async () => {
    const { s, traccar } = servico({ associadoEm: new Date('2026-09-01') });

    await expect(s.comandoDeTeste('item-1', TENANT, 'block')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(traccar.sendCommandNow).not.toHaveBeenCalled();
  });
});
