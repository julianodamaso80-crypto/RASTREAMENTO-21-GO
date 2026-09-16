import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockTraccarService } from './stock-traccar.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

/**
 * TAG no Estoque (dono, 16/09/2026): TAG sem associado fica na MESMA lista do
 * Estoque e é vinculada pelo MESMO "Associar (SGA)". Mas TAG não fala com o
 * servidor GPS — nada do que envolve Traccar pode tocá-la — e o vínculo não
 * pode virar Device (desvincularia o rastreador do carro) nem Vehicle/Associate
 * (TAG é segredo interno e isso chegaria ao app do associado).
 */

const TENANT = '11111111-1111-1111-1111-111111111111';

const ATIVO: HinovaLookupResult = {
  encontrado: true,
  ativo: true,
  fonte: 'espelho',
  cliente: { nome: 'KAIO FERREIRA STENCK', cpf: '12345678901' },
  veiculo: {
    placa: 'SQV8G40',
    chassi: '9C2KC2210PR113679',
    codigoModelo: '1',
    modelo: 'CG 160',
    codigoVeiculo: '20842',
  },
  situacao: { codigo: '1', descricao: 'ATIVO', financeira: 'ADIMPLENTE', dataVencimento: null },
} as HinovaLookupResult;

const DTO = { placa: 'SQV8G40', technicianName: 'Técnico', installLocation: 'painel' };

function montar(item: Record<string, unknown>, lookup: HinovaLookupResult = ATIVO) {
  const tx = {
    tagLink: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'link-1' }) },
    stockItem: { update: jest.fn().mockResolvedValue({}) },
    associate: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    vehicle: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    device: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    stockItem: {
      findFirst: jest.fn().mockResolvedValue(item),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    tagLink: { findFirst: jest.fn().mockResolvedValue(null) },
    tagRefreshRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'ped-1', requestedAt: new Date() }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    technician: {
      findFirst: jest.fn().mockResolvedValue({ id: 'tec', name: 'Tec', active: true, canReceiveEquipment: true }),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const traccar = { getDeviceByUniqueId: jest.fn(), createDevice: jest.fn(), getPositions: jest.fn() };
  const stockTraccar = {
    ensureDevice: jest.fn(),
    responderIgnicaoNaHora: jest.fn(),
    voltarAoFiltroNormal: jest.fn(),
    imeisComunicando: jest.fn().mockResolvedValue({ comunicando: [], semGps: [] }),
  };
  const pendencias = { lookupNoEspelho: jest.fn().mockResolvedValue(null), removeByPlate: jest.fn() };
  const s = new StockService(
    prisma as never,
    { lookupByPlate: jest.fn().mockResolvedValue({ encontrado: false, motivo: 'x' }) } as never,
    traccar as never,
    {} as never, // deviceRegistry
    {} as never, // deviceHealth
    stockTraccar as never,
    pendencias as never,
    { lookup: jest.fn().mockResolvedValue(lookup), contato: jest.fn(), tipoCru: jest.fn() } as never,
    {} as never,
    {} as never,
  );
  return { s, prisma, tx, traccar, stockTraccar, pendencias };
}

const TAG = { id: 'item-tag', imei: '808092604011925', kind: 'TAG', traccarDeviceId: null };

describe('Estoque — TAG no Associar (SGA)', () => {
  it('grava o vínculo da TAG e baixa o item, sem Device, Vehicle, Associate nem Traccar', async () => {
    const { s, tx, traccar, stockTraccar, pendencias } = montar(TAG);
    const r = await s.associate('item-tag', TENANT, DTO as never, false, 'user-1');

    expect(tx.tagLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          serialNumber: '808092604011925',
          plate: 'SQV8G40',
          chassi: '9C2KC2210PR113679',
          hinovaVehicleCode: '20842',
          associateName: 'KAIO FERREIRA STENCK',
          associateCpf: '12345678901',
          origin: 'ESTOQUE',
          createdById: 'user-1',
        }),
      }),
    );
    expect(tx.stockItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'item-tag' }, data: expect.objectContaining({ associatedAt: expect.any(Date) }) }),
    );
    for (const m of [tx.device.create, tx.device.update, tx.vehicle.create, tx.vehicle.update, tx.associate.create, tx.associate.update]) {
      expect(m).not.toHaveBeenCalled();
    }
    expect(traccar.getDeviceByUniqueId).not.toHaveBeenCalled();
    expect(traccar.createDevice).not.toHaveBeenCalled();
    expect(stockTraccar.voltarAoFiltroNormal).not.toHaveBeenCalled();
    // Pendência de rastreador da placa não é baixada por instalar TAG.
    expect(pendencias.removeByPlate).not.toHaveBeenCalled();
    expect(r).toMatchObject({ tag: true, placa: 'SQV8G40' });
  });

  it('segue a mesma regra de situação: associado inativo bloqueia', async () => {
    const inativo = { ...ATIVO, ativo: false, situacao: { ...ATIVO.situacao, codigo: '2', descricao: 'INATIVO' } } as HinovaLookupResult;
    const { s, tx } = montar(TAG, inativo);
    await expect(s.associate('item-tag', TENANT, DTO as never, false)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.tagLink.create).not.toHaveBeenCalled();
  });

  it('TAG já vinculada a outro veículo não é vinculada de novo', async () => {
    const { s, prisma, tx } = montar(TAG);
    prisma.tagLink.findFirst.mockResolvedValue({ id: 'x', plate: 'OUT1A11' });
    await expect(s.associate('item-tag', TENANT, DTO as never, false)).rejects.toThrow(/OUT1A11/);
    expect(tx.tagLink.create).not.toHaveBeenCalled();
  });
});

describe('Estoque — Atualizar TAG (botão igual ao da Rede)', () => {
  it('cria o pedido e devolve quando libera de novo', async () => {
    const { s, prisma } = montar(TAG);
    const r = await s.solicitarAtualizacaoTag('item-tag', TENANT, 'user-1');
    expect(prisma.tagRefreshRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          serialNumber: '808092604011925',
          requestedById: 'user-1',
        }),
      }),
    );
    expect(r).toMatchObject({ pendente: true });
    expect(new Date(r.disponivelEm).getTime() - new Date(r.solicitadoEm).getTime()).toBe(180_000);
  });

  it('recusa com 429 antes dos 3 minutos', async () => {
    const { s, prisma } = montar(TAG);
    prisma.tagRefreshRequest.findFirst.mockResolvedValue({
      requestedAt: new Date(Date.now() - 60_000),
      doneAt: null,
      positionsFound: null,
    });
    await expect(s.solicitarAtualizacaoTag('item-tag', TENANT)).rejects.toMatchObject({
      status: 429,
    });
    expect(prisma.tagRefreshRequest.create).not.toHaveBeenCalled();
  });

  it('rastreador não tem Atualizar TAG', async () => {
    const { s, prisma } = montar(TAG);
    prisma.stockItem.findFirst.mockResolvedValue(null);
    await expect(s.solicitarAtualizacaoTag('item-rastreador', TENANT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.stockItem.findFirst.mock.calls.at(-1)[0].where).toMatchObject({ kind: 'TAG' });
  });

  it('estado diz quantos avistamentos vieram — zero é resposta honesta', async () => {
    const { s, prisma } = montar(TAG);
    const pedido = new Date(Date.now() - 200_000);
    prisma.tagRefreshRequest.findFirst.mockResolvedValue({
      requestedAt: pedido,
      doneAt: new Date(pedido.getTime() + 30_000),
      positionsFound: 0,
    });
    const r = await s.estadoAtualizacaoTagDoEstoque('item-tag', TENANT);
    expect(r).toMatchObject({ pendente: false, avistamentosNovos: 0, segundosRestantes: 0 });
  });

  it('a listagem devolve a última posição de cada TAG', async () => {
    const { s, prisma } = montar(TAG);
    prisma.stockItem.findMany.mockResolvedValue([{ id: 'i1', imei: '808092604011925', kind: 'TAG' }]);
    prisma.$queryRaw.mockResolvedValue([
      {
        serial_number: '808092604011925',
        latitude: -22.9,
        longitude: -43.5,
        accuracy_m: 41,
        seen_at: new Date('2026-09-16T17:09:40Z'),
      },
    ]);
    const r = await s.findAll(TENANT, { page: 1, perPage: 20 } as never);
    expect(r.data[0]).toMatchObject({
      tagPosition: { lat: -22.9, lng: -43.5, accuracyM: 41 },
    });
  });
});

describe('Estoque — TAG nunca chega ao servidor GPS', () => {
  it('conferência, validação e bloqueio de teste só procuram RASTREADOR', async () => {
    const { s, prisma } = montar(TAG);
    prisma.stockItem.findFirst.mockResolvedValue(null);
    await expect(s.signal('item-tag', TENANT)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.validate('item-tag', TENANT, { approved: true } as never, 'u', 'U')).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.comandoDeTeste('item-tag', TENANT, 'block')).rejects.toBeInstanceOf(NotFoundException);
    for (const call of prisma.stockItem.findFirst.mock.calls) {
      expect(call[0].where).toMatchObject({ kind: 'RASTREADOR' });
    }
    await s.signalBatch(['item-tag'], TENANT);
    expect(prisma.stockItem.findMany.mock.calls.at(-1)[0].where).toMatchObject({ kind: 'RASTREADOR' });
  });

  it('não vai para o login do técnico', async () => {
    const { s, prisma } = montar(TAG);
    await s.assign(TENANT, { stockItemIds: ['item-tag'], technicianId: 'tec' } as never, 'user-1');
    expect(prisma.stockItem.findMany.mock.calls.at(-1)[0].where).toMatchObject({ kind: 'RASTREADOR' });
  });

  it('filtro de conexão (online/offline/sem GPS) lista só rastreador', async () => {
    const { s, prisma } = montar(TAG);
    await s.findAll(TENANT, { page: 1, perPage: 20, conexao: 'offline' } as never);
    expect(prisma.stockItem.findMany.mock.calls.at(-1)[0].where).toMatchObject({ kind: 'RASTREADOR' });
  });

  it('filtro por tipo: TAG e RASTREADOR', async () => {
    const { s, prisma } = montar(TAG);
    await s.findAll(TENANT, { page: 1, perPage: 20, tipo: 'TAG' } as never);
    expect(prisma.stockItem.findMany.mock.calls.at(-1)[0].where).toMatchObject({ kind: 'TAG' });
    await s.findAll(TENANT, { page: 1, perPage: 20, tipo: 'RASTREADOR' } as never);
    expect(prisma.stockItem.findMany.mock.calls.at(-1)[0].where).toMatchObject({ kind: 'RASTREADOR' });
  });

  it('stats conta rastreadores e TAGs separados', async () => {
    const { s, prisma } = montar(TAG);
    prisma.stockItem.groupBy.mockImplementation(({ by }: { by: string[] }) =>
      Promise.resolve(
        by[0] === 'kind'
          ? [
              { kind: 'RASTREADOR', _count: { _all: 1501 } },
              { kind: 'TAG', _count: { _all: 530 } },
            ]
          : [],
      ),
    );
    const r = await s.stats(TENANT);
    expect(r).toMatchObject({ rastreadores: 1501, tags: 530 });
  });

  it('cadastro automático e cartões de conexão ignoram TAG; o mapa busca TAG à parte', async () => {
    const prisma = {
      stockItem: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const st = new StockTraccarService(prisma as never, {} as never, {} as never);
    await st.ensurePending(TENANT);
    await st.connectivity(TENANT).catch(() => undefined);
    await st.mapPoints(TENANT).catch(() => undefined);

    const kinds = prisma.stockItem.findMany.mock.calls.map((c) => c[0].where.kind);
    // ensurePending e connectivity: só rastreador. mapPoints: uma busca de TAG
    // (o ponto vem da rede Find My) e uma de rastreador (vem do Traccar).
    expect(kinds.filter((k) => k === 'RASTREADOR').length).toBeGreaterThanOrEqual(3);
    expect(kinds).toContain('TAG');
  });
});
