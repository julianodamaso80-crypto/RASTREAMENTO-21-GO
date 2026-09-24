import { ClientsService } from './clients.service';

/**
 * TAG no Mapa — pedido do dono (21/09/2026): "as tags também têm que estar em
 * mapas, até porque preciso rastrear elas, igual é com rastreador, claro
 * respeitando a limitação da tag".
 *
 * A régua: o Mapa mostra EXATAMENTE os cards de "só TAG" que Clientes Ativos
 * mostra. Se um contar uma TAG que o outro não conta, os dois totais voltam a
 * não conversar — que foi a reclamação que originou isto (990 x 3835).
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const AGORA = new Date('2026-09-21T20:00:00Z');

const LINK_MOTO = {
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

// TAG num carro que JÁ tem rastreador nosso: em Clientes Ativos vira selo no
// card do carro. No Mapa ela aparece (dono, 24/09: "tem que aparecer no mapa
// para a gente rastrear") marcada `comRastreador`, fora do total de "Todos".
const LINK_CARRO = {
  ...LINK_MOTO,
  id: 'l2',
  serialNumber: '808092605075999',
  plate: 'CAR1A11',
  chassi: '9BD000000000001',
  hinovaVehicleCode: '100',
};

const sga = (plate: string, code: string, extra: Record<string, unknown> = {}) => ({
  plate,
  chassi: null,
  hinovaVehicleCode: code,
  associateName: `DONO ${plate}`,
  cpf: '55566677788',
  phone: '21999990000',
  email: null,
  brandModel: 'HONDA CG 160',
  situationLabel: 'ATIVO',
  vehicleType: 'MOTOCICLETA (ATé 400CC)',
  ...extra,
});

function montarPrisma() {
  return {
    vehicle: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockImplementation(({ select }: { select?: unknown }) =>
        select ? Promise.resolve([{ plate: 'CAR1A11' }]) : Promise.resolve([]),
      ),
    },
    position: { groupBy: jest.fn().mockResolvedValue([]) },
    tagLink: { findMany: jest.fn().mockResolvedValue([LINK_MOTO, LINK_CARRO]) },
    sgaVehicle: {
      findMany: jest.fn().mockResolvedValue([sga('MOTO2B22', '200'), sga('CAR1A11', '100')]),
    },
    $queryRaw: jest.fn().mockResolvedValue([
      { serial_number: LINK_MOTO.serialNumber, latitude: -22.7, longitude: -43.3, accuracy_m: 40, seen_at: AGORA },
      { serial_number: LINK_CARRO.serialNumber, latitude: -22.8, longitude: -43.4, accuracy_m: 30, seen_at: AGORA },
    ]),
  };
}

describe('tagsNoMapa — as TAGs de cliente no mapa', () => {
  it('devolve cada TAG sem rastreador com a última posição e a precisão', async () => {
    const s = new ClientsService(montarPrisma() as never);
    const r = await s.tagsNoMapa(TENANT);

    const semRastreador = r.filter((t) => !t.comRastreador);
    expect(semRastreador).toHaveLength(1);
    expect(semRastreador[0]).toEqual({
      id: 'tag-l1',
      serialNumber: LINK_MOTO.serialNumber,
      plate: 'MOTO2B22',
      associateName: 'DONO MOTO2B22',
      model: 'HONDA CG 160',
      vehicleType: 'MOTORCYCLE',
      latitude: -22.7,
      longitude: -43.3,
      accuracyM: 40,
      seenAt: AGORA,
      comRastreador: false,
    });
  });

  it('TAG em carro que já tem rastreador aparece, marcada comRastreador', async () => {
    const s = new ClientsService(montarPrisma() as never);
    const r = await s.tagsNoMapa(TENANT);
    expect(r.find((t) => t.plate === 'CAR1A11')).toMatchObject({
      serialNumber: LINK_CARRO.serialNumber,
      latitude: -22.8,
      longitude: -43.4,
      comRastreador: true,
    });
  });

  it('é o MESMO conjunto de "só TAG" que Clientes Ativos conta', async () => {
    const prisma = montarPrisma();
    const s = new ClientsService(prisma as never);
    const ativos = await s.findAssets(TENANT, { verTags: true, perPage: 500 });
    const soTagAtivos = ativos.data
      .filter((a) => (a as { soTag?: boolean }).soTag)
      .map((a) => a.id)
      .sort();

    const noMapa = (await s.tagsNoMapa(TENANT))
      .filter((t) => !t.comRastreador)
      .map((t) => t.id)
      .sort();
    expect(noMapa).toEqual(soTagAtivos);
  });

  it('TAG sem posição ainda aparece (na lista), com coordenada nula', async () => {
    const prisma = montarPrisma();
    // Vínculo feito à mão no Estoque aparece mesmo antes da primeira posição.
    prisma.tagLink.findMany.mockResolvedValue([{ ...LINK_MOTO, origin: 'ESTOQUE' }]);
    prisma.$queryRaw.mockResolvedValue([]);
    const s = new ClientsService(prisma as never);
    const r = (await s.tagsNoMapa(TENANT)).filter((t) => !t.comRastreador);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ latitude: null, longitude: null, accuracyM: null, seenAt: null });
  });

  it('associado que saiu de ATIVO no SGA some do mapa', async () => {
    const prisma = montarPrisma();
    prisma.sgaVehicle.findMany.mockResolvedValue([
      sga('MOTO2B22', '200', { situationLabel: 'INATIVO' }),
      sga('CAR1A11', '100'),
    ]);
    const s = new ClientsService(prisma as never);
    expect((await s.tagsNoMapa(TENANT)).map((t) => t.plate)).toEqual(['CAR1A11']);
  });
});
