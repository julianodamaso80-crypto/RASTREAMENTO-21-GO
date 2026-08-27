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

    await service.findActive(TENANT, { cobertura: 'TODAS' });

    // Duas consultas batem no espelho e elas têm papéis diferentes: a de
    // COBERTURA varre tudo (precisa saber quais placas são rastreáveis antes
    // de paginar) e a de CRUZAMENTO enriquece só os cards da página. O que
    // este teste protege é a segunda — puxar a base inteira para montar 20
    // cards seria o desperdício.
    const cruzamento = rdvArgs.find((a: any) => a.where.plate);
    expect(cruzamento).toBeDefined();
    expect(cruzamento.where.tenantId).toBe(TENANT);
    expect(cruzamento.where.plate).toEqual({ in: ['RIZ3B88', 'KXW8940'] });
  });

  it('a consulta de cobertura pede só o que precisa do espelho', async () => {
    const { service, rdvArgs } = montar([linhaSga()]);

    await service.findActive(TENANT, { cobertura: 'TODAS' });

    const cobertura = rdvArgs.find((a: any) => !a.where.plate);
    expect(cobertura).toBeDefined();
    expect(cobertura.where.tenantId).toBe(TENANT);
    // Sem `select`, seriam 4,8 mil linhas inteiras a cada página.
    expect(Object.keys(cobertura.select ?? {}).sort()).toEqual([
      'lastLat',
      'lastLng',
      'plate',
    ]);
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

/**
 * A regra de "TAG ativa", do dono, em 27/08/2026:
 *
 *   "Só entra ali veículo que consigo rastrear a TAG — clicar e ver
 *    localização e histórico. Saber quem é o associado e onde essa TAG está
 *    marcando. Se não, ela não está ativa."
 *
 * Antes disso a aba listava os 9.764 contratos do SGA e a maioria abria sem
 * posição nenhuma. O número era grande e não servia para trabalhar.
 */
describe('BleTagsService.findActive — a régua de "ativa"', () => {
  function montarComEspelho(placasComPosicao: string[], contratos: any[]) {
    const espelho = placasComPosicao.map((plate, i) => ({
      id: `r${i}`,
      plate,
      tagIdentifier: `tag-${i}`,
      tagModel: 'KTAG',
      lastLat: -22.939,
      lastLng: -43.56,
      seenAt: new Date('2026-08-20T10:00:00.000Z'),
    }));

    const prisma: any = {
      sgaVehicle: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(filtrar(contratos, where)),
        ),
        count: jest.fn(({ where }: any) =>
          Promise.resolve(filtrar(contratos, where).length),
        ),
      },
      vehicle: { findMany: jest.fn(() => Promise.resolve([])) },
      rdvTag: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            where?.plate?.in
              ? espelho.filter((e) => where.plate.in.includes(e.plate))
              : espelho,
          ),
        ),
      },
    };
    return new BleTagsService(prisma);
  }

  /** Imita o recorte por placa que o Prisma faria. */
  function filtrar(linhas: any[], where: any) {
    if (!where?.plate) return linhas;
    if (where.plate.in) return linhas.filter((l) => where.plate.in.includes(l.plate));
    if (where.plate.notIn)
      return linhas.filter((l) => !where.plate.notIn.includes(l.plate));
    return linhas;
  }

  const contratos = [
    linhaSga({ id: 'a', plate: 'AAA1A11' }),
    linhaSga({ id: 'b', plate: 'BBB2B22' }),
    linhaSga({ id: 'c', plate: 'CCC3C33' }),
  ];

  it('por padrão mostra só quem tem posição da TAG', async () => {
    const service = montarComEspelho(['AAA1A11'], contratos);

    const r = await service.findActive(TENANT);

    expect(r.data.map((d: any) => d.plate)).toEqual(['AAA1A11']);
    expect(r.meta.cobertura).toBe('RASTREAVEL');
  });

  it('conta contratadas e rastreáveis lado a lado, sem esconder a diferença', async () => {
    const service = montarComEspelho(['AAA1A11'], contratos);

    const r = await service.findActive(TENANT);

    expect(r.meta.contratadas).toBe(3);
    expect(r.meta.rastreaveis).toBe(1);
    expect(r.meta.semPosicao).toBe(2);
  });

  it('SEM_POSICAO mostra exatamente o que falta importar', async () => {
    const service = montarComEspelho(['AAA1A11'], contratos);

    const r = await service.findActive(TENANT, { cobertura: 'SEM_POSICAO' });

    expect(r.data.map((d: any) => d.plate).sort()).toEqual([
      'BBB2B22',
      'CCC3C33',
    ]);
  });

  it('TODAS mantém a lista completa de contratos', async () => {
    const service = montarComEspelho(['AAA1A11'], contratos);

    const r = await service.findActive(TENANT, { cobertura: 'TODAS' });

    expect(r.data).toHaveLength(3);
  });

  it('espelho vazio não deixa a aba mentir: nenhuma ativa', async () => {
    const service = montarComEspelho([], contratos);

    const r = await service.findActive(TENANT);

    expect(r.data).toHaveLength(0);
    expect(r.meta.rastreaveis).toBe(0);
    expect(r.meta.contratadas).toBe(3);
  });
});
