import { SearchService } from './search.service';

/**
 * Busca única do painel: o operador tem UM dado na mão (placa, chassi, CPF,
 * nome, chip ou IMEI) e precisa achar o associado esteja ele onde estiver —
 * ativo com rastreador, aguardando instalação, só no cadastro do SGA, com TAG
 * ou ainda no estoque.
 */
const TENANT = '11111111-1111-1111-1111-111111111111';

function montar(dados: Partial<Record<string, any[]>> = {}) {
  const chamadas: Record<string, any[]> = {};
  const tabela = (nome: string) => ({
    findMany: jest.fn((args: any) => {
      (chamadas[nome] ??= []).push(args);
      return Promise.resolve(dados[nome] ?? []);
    }),
  });

  const prisma: any = {
    vehicle: tabela('vehicle'),
    installationPending: tabela('installationPending'),
    sgaVehicle: tabela('sgaVehicle'),
    stockItem: tabela('stockItem'),
    chip: tabela('chip'),
    rdvTag: tabela('rdvTag'),
  };

  return { service: new SearchService(prisma), chamadas };
}

const veiculo = (over: any = {}) => ({
  id: 'v1',
  plate: 'RJQ1B12',
  chassi: '9BWZZZ377VT004251',
  brand: 'Fiat',
  model: 'Argo',
  year: 2020,
  color: 'Prata',
  vehicleType: 'CAR',
  device: {
    imei: '866557086559061',
    status: 'ACTIVE',
    chip: { iccid: '89550110000000000012', phoneNumber: '11999887766' },
  },
  associate: {
    id: 'a1',
    name: 'ANA CAROLINE DA SILVA',
    cpf: '12345678901',
    phone: '21988887777',
  },
  ...over,
});

describe('SearchService.buscar', () => {
  it('não vai ao banco com termo vazio', async () => {
    const { service, chamadas } = montar();
    const r = await service.buscar(TENANT, '  ');
    expect(r.total).toBe(0);
    expect(r.grupos).toEqual([]);
    expect(Object.keys(chamadas)).toHaveLength(0);
  });

  it('filtra por tenant em TODAS as fontes', async () => {
    const { service, chamadas } = montar();
    // Termo numérico: é o único que pode casar nas seis fontes de uma vez.
    await service.buscar(TENANT, '866557086559061');

    for (const args of Object.values(chamadas)) {
      expect(args[0].where.tenantId).toBe(TENANT);
    }
    expect(Object.keys(chamadas).sort()).toEqual([
      'chip',
      'installationPending',
      'rdvTag',
      'sgaVehicle',
      'stockItem',
      'vehicle',
    ]);
  });

  it('não consulta fonte que não tem campo capaz de casar com o termo', async () => {
    const { service, chamadas } = montar();
    // Chip e estoque só guardam número: procurar um nome ali é consulta
    // garantidamente vazia — e `contains: ''` traria a tabela inteira.
    await service.buscar(TENANT, 'ana');

    expect(chamadas.chip).toBeUndefined();
    expect(chamadas.vehicle).toBeDefined();
    expect(chamadas.sgaVehicle).toBeDefined();
  });

  it('acha o ativo pela placa e devolve o caminho do mapa', async () => {
    const { service } = montar({ vehicle: [veiculo()] });
    const r = await service.buscar(TENANT, 'rjq1b12');

    const grupo = r.grupos.find((g) => g.tipo === 'ATIVO')!;
    expect(grupo.itens[0].titulo).toBe('RJQ1B12');
    expect(grupo.itens[0].subtitulo).toBe('ANA CAROLINE DA SILVA');
    expect(grupo.itens[0].href).toBe('/mapa?placa=RJQ1B12');
    expect(r.total).toBe(1);
  });

  it('separa veículo sem rastreador do ativo', async () => {
    const { service } = montar({
      vehicle: [veiculo(), veiculo({ id: 'v2', plate: 'ABC1D23', device: null })],
    });
    const r = await service.buscar(TENANT, 'ana');

    expect(r.grupos.find((g) => g.tipo === 'ATIVO')!.itens).toHaveLength(1);
    const sem = r.grupos.find((g) => g.tipo === 'VEICULO')!;
    expect(sem.itens[0].titulo).toBe('ABC1D23');
    expect(sem.itens[0].href).toBe('/veiculos/v2');
  });

  it('acha por CPF com máscara', async () => {
    const { service, chamadas } = montar({ vehicle: [veiculo()] });
    await service.buscar(TENANT, '123.456.789-01');

    // O documento vai ao banco sem máscara — é assim que está gravado.
    expect(chamadas.vehicle[0].where.OR).toContainEqual({
      associate: { cpf: { contains: '12345678901' } },
    });
  });

  it('acha o veículo pelo chip (ICCID ou número da linha)', async () => {
    const { service, chamadas } = montar({ vehicle: [veiculo()] });
    await service.buscar(TENANT, '89550110000000000012');

    const or = JSON.stringify(chamadas.vehicle[0].where.OR);
    expect(or).toContain('iccid');
    expect(or).toContain('phoneNumber');
    // A linha também é procurada no estoque, que guarda o campo `line`.
    expect(JSON.stringify(chamadas.stockItem[0].where.OR)).toContain('line');
  });

  it('nome não vira busca por documento (contains vazio traria a base inteira)', async () => {
    const { service, chamadas } = montar();
    await service.buscar(TENANT, 'ana');

    for (const args of Object.values(chamadas)) {
      expect(JSON.stringify(args[0].where)).not.toContain('""');
    }
  });

  it('não repete no SGA a placa que já apareceu como ativo', async () => {
    const { service } = montar({
      vehicle: [veiculo()],
      sgaVehicle: [
        {
          id: 's1',
          plate: 'RJQ1B12',
          associateName: 'ANA CAROLINE DA SILVA',
          cpf: '12345678901',
          situationLabel: 'ATIVO',
          brandModel: 'FIAT ARGO',
        },
        {
          id: 's2',
          plate: 'XYZ9A88',
          associateName: 'ANA MARIA',
          cpf: '98765432100',
          situationLabel: 'INATIVO',
          brandModel: 'HONDA CG',
        },
      ],
    });
    const r = await service.buscar(TENANT, 'ana');

    const sga = r.grupos.find((g) => g.tipo === 'CADASTRO_SGA')!;
    expect(sga.itens.map((i) => i.titulo)).toEqual(['XYZ9A88']);
  });

  it('cadastro do SGA aparece mesmo inativo, com a situação à mostra', async () => {
    const { service } = montar({
      sgaVehicle: [
        {
          id: 's2',
          plate: 'XYZ9A88',
          associateName: 'JOÃO',
          cpf: '98765432100',
          phone: '21977776666',
          situationLabel: 'INADIMPLENTE',
          brandModel: 'HONDA CG',
        },
      ],
    });
    const r = await service.buscar(TENANT, 'joão');

    const item = r.grupos.find((g) => g.tipo === 'CADASTRO_SGA')!.itens[0];
    expect(item.situacao).toBe('INADIMPLENTE');
    expect(item.detalhes.join(' ')).toContain('21977776666');
  });

  it('ignora veículo e chip apagados', async () => {
    const { service, chamadas } = montar();
    await service.buscar(TENANT, '866557086559061');

    expect(chamadas.vehicle[0].where.deletedAt).toBeNull();
    expect(chamadas.chip[0].where.deletedAt).toBeNull();
    expect(chamadas.stockItem[0].where.deletedAt).toBeNull();
  });

  it('limita o número de itens por grupo', async () => {
    const muitos = Array.from({ length: 30 }, (_, i) =>
      veiculo({ id: `v${i}`, plate: `AAA${i}` }),
    );
    const { service, chamadas } = montar({ vehicle: muitos });
    const r = await service.buscar(TENANT, 'ana', 5);

    expect(chamadas.vehicle[0].take).toBeLessThanOrEqual(30);
    expect(r.grupos.find((g) => g.tipo === 'ATIVO')!.itens.length).toBe(5);
  });
});
