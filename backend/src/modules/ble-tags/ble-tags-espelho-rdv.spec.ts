import { BleTagsService } from './ble-tags.service';

/**
 * O card da TAG ativa precisa de duas coisas que o SGA não tem: QUAL é a TAG
 * (número e modelo) e ONDE ela foi vista pela última vez.
 *
 * Isso vive em `rdv_tags`, espelho da plataforma incumbente. Não virou `Device`
 * porque `Device.vehicleId` é `@unique` e 8.812 dessas TAGs estão em veículo que
 * TAMBÉM tem rastreador — ver `reference_tag_ativa_regra`.
 *
 * A regra que estes testes protegem: **a posição da TAG nunca se mistura com a
 * do rastreador**. São campos separados, com carimbos de tempo separados.
 */
const TENANT = '11111111-1111-1111-1111-111111111111';

function montar(rows: any[] = [], espelho: any[] = [], veiculos: any[] = []) {
  const rdvArgs: any[] = [];
  const prisma: any = {
    sgaVehicle: {
      findMany: jest.fn(() => Promise.resolve(rows)),
      count: jest.fn(() => Promise.resolve(rows.length)),
    },
    vehicle: { findMany: jest.fn(() => Promise.resolve(veiculos)) },
    rdvTag: {
      findMany: jest.fn((args) => {
        rdvArgs.push(args);
        return Promise.resolve(espelho);
      }),
    },
  };
  return { service: new BleTagsService(prisma), rdvArgs };
}

const linhaSga = (over: any = {}) => ({
  id: 's1',
  plate: 'RIZ3B88',
  chassi: null,
  brandModel: 'HONDA CG 160',
  associateName: 'LUIZ FERNANDO',
  cpf: '10286114712',
  phone: null,
  adhesionCode: '8',
  contractDate: new Date('2026-08-14T00:00:00.000Z'),
  hinovaVehicleCode: '123',
  ...over,
});

const linhaEspelho = (over: any = {}) => ({
  id: 'r1',
  plate: 'RIZ3B88',
  tagIdentifier: '000092603014784',
  tagModel: 'KTAG',
  lastLat: -22.9390615,
  lastLng: -43.560026,
  seenAt: new Date('2026-04-15T17:13:58.000Z'),
  ...over,
});

describe('BleTagsService.findActive — espelho da TAG', () => {
  it('cruza só as placas da página, não a base inteira', async () => {
    const { service, rdvArgs } = montar([
      linhaSga(),
      linhaSga({ id: 's2', plate: 'KXW8940' }),
    ]);

    await service.findActive(TENANT);

    expect(rdvArgs[0].where.tenantId).toBe(TENANT);
    expect(rdvArgs[0].where.plate).toEqual({ in: ['RIZ3B88', 'KXW8940'] });
  });

  it('põe número, modelo e posição da TAG no card', async () => {
    const { service } = montar([linhaSga()], [linhaEspelho()]);

    const r = await service.findActive(TENANT);

    expect(r.data[0].tagEspelho).toEqual({
      identificador: '000092603014784',
      modelo: 'KTAG',
      latitude: -22.9390615,
      longitude: -43.560026,
      seenAt: '2026-04-15T17:13:58.000Z',
      origem: 'REDEVEICULOS',
    });
  });

  it('TAG sem posição entra no card mesmo assim — sabemos qual é, não onde está', async () => {
    const { service } = montar(
      [linhaSga()],
      [linhaEspelho({ lastLat: null, lastLng: null, seenAt: null })],
    );

    const r = await service.findActive(TENANT);

    expect(r.data[0].tagEspelho?.identificador).toBe('000092603014784');
    expect(r.data[0].tagEspelho?.latitude).toBeNull();
    expect(r.data[0].tagEspelho?.seenAt).toBeNull();
  });

  it('posição da TAG NUNCA ocupa o campo do rastreador', async () => {
    const { service } = montar([linhaSga()], [linhaEspelho()]);

    const r = await service.findActive(TENANT);

    // Sem rastreador nosso no veículo, o campo do GPS fica vazio — a TAG não
    // preenche a lacuna. Misturar as duas esconderia um roubo em andamento.
    expect(r.data[0].ultimaPosicao).toBeNull();
    expect(r.data[0].tagEspelho?.latitude).toBe(-22.9390615);
  });

  it('placa sem TAG no espelho não inventa TAG', async () => {
    const { service } = montar([linhaSga({ plate: 'KXW8940' })], []);

    const r = await service.findActive(TENANT);

    expect(r.data[0].tagEspelho).toBeNull();
  });

  it('quando a mesma placa tem duas TAGs, vale a vista mais recente', async () => {
    const { service } = montar(
      [linhaSga()],
      [
        linhaEspelho({
          id: 'r-velha',
          tagIdentifier: 'VELHA',
          seenAt: new Date('2026-01-10T00:00:00.000Z'),
        }),
        linhaEspelho({
          id: 'r-nova',
          tagIdentifier: 'NOVA',
          seenAt: new Date('2026-08-20T00:00:00.000Z'),
        }),
      ],
    );

    const r = await service.findActive(TENANT);

    expect(r.data[0].tagEspelho?.identificador).toBe('NOVA');
  });

  it('placa casa sem depender de caixa ou espaço', async () => {
    const { service } = montar(
      [linhaSga({ plate: 'riz3b88 ' })],
      [linhaEspelho({ plate: 'RIZ3B88' })],
    );

    const r = await service.findActive(TENANT);

    expect(r.data[0].tagEspelho?.identificador).toBe('000092603014784');
  });
});
