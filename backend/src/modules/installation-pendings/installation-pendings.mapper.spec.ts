import {
  ehPendencia,
  montarFila,
  montarTelefone,
  paraData,
  paraLinha,
} from './installation-pendings.mapper';
import type { HinovaRawVehicle } from '../hinova/hinova.interface';

const TENANT = 'tenant-1';

/**
 * Formatos copiados de respostas reais do SGA (POST /listar/veiculo em
 * 2026-07-22), com nome e CPF trocados por fictícios.
 */
function veiculo(over: Partial<HinovaRawVehicle> = {}): HinovaRawVehicle {
  return {
    codigo_veiculo: '2605',
    codigo_associado: '881',
    placa: 'LLB8H47',
    chassi: '9BWAA05Z4A4116200',
    marca: 'VW - VOLKSWAGEN',
    modelo: 'FOX 1.0 MI TOTAL FLEX 8V 5P',
    tipo: 'VEICULOS LEVES',
    codigo_tipo_adesao: '1',
    valor_fipe_protegido: '36456.00',
    data_contrato: '2026-07-10T00:00:00-0300',
    codigo_tabela_avaliacao: '1',
    nome_associado: 'FULANO DE TAL',
    cpf_associado: '00000000191',
    email: 'fulano@example.com',
    ddd_celular: '21',
    telefone_celular: '9689-41179',
    ddd: '21',
    telefone: '9999-99999',
    nome_voluntario: 'CONSULTOR X',
    ...over,
  };
}

const associados = [{ codigo_associado: '881', cidade: 'RIO DE JANEIRO', bairro: 'GUARATIBA' }];
const mapaEnderecos = new Map(associados.map((a) => [a.codigo_associado, a]));

describe('ehPendencia', () => {
  it('aceita 1 (pendente rastreador) e 10 (pendente TAG)', () => {
    expect(ehPendencia(veiculo({ codigo_tipo_adesao: '1' }))).toBe(true);
    expect(ehPendencia(veiculo({ codigo_tipo_adesao: '10' }))).toBe(true);
  });

  it('recusa os demais tipos de adesão', () => {
    // 2 instalado · 5 não precisa · 8 rastreador+tag · 9 só tag
    for (const tipo of ['2', '3', '4', '5', '6', '7', '8', '9', '0']) {
      expect(ehPendencia(veiculo({ codigo_tipo_adesao: tipo }))).toBe(false);
    }
  });

  it('não confunde 1 com 10 por prefixo', () => {
    expect(ehPendencia(veiculo({ codigo_tipo_adesao: '11' }))).toBe(false);
    expect(ehPendencia(veiculo({ codigo_tipo_adesao: '100' }))).toBe(false);
  });
});

describe('paraData', () => {
  it('extrai a data do formato com offset do SGA', () => {
    expect(paraData('2026-07-10T00:00:00-0300')?.toISOString()).toBe(
      '2026-07-10T00:00:00.000Z',
    );
  });

  it('devolve null pra valor ausente ou inválido', () => {
    expect(paraData(undefined)).toBeNull();
    expect(paraData('')).toBeNull();
    expect(paraData('sem data')).toBeNull();
  });
});

describe('montarTelefone', () => {
  it('prefere o celular ao fixo', () => {
    expect(montarTelefone(veiculo())).toBe('21 9689-41179');
  });

  it('descarta placeholder de 9s e cai pro próximo número', () => {
    const v = veiculo({ telefone_celular: '99999-9999', telefone: '2412-0014' });
    expect(montarTelefone(v)).toBe('21 2412-0014');
  });

  it('devolve null quando todos os números são placeholder', () => {
    const v = veiculo({ telefone_celular: '99999-9999', telefone: '9999-99999' });
    expect(montarTelefone(v)).toBeNull();
  });
});

describe('paraLinha', () => {
  it('traz cidade e bairro do associado (não vêm no veículo)', () => {
    const linha = paraLinha(veiculo(), mapaEnderecos, TENANT);
    expect(linha?.city).toBe('RIO DE JANEIRO');
    expect(linha?.neighborhood).toBe('GUARATIBA');
  });

  it('mapeia tipo, valor e modelo concatenado', () => {
    const linha = paraLinha(veiculo({ codigo_tipo_adesao: '10' }), mapaEnderecos, TENANT);
    expect(linha?.pendingType).toBe('TAG');
    expect(linha?.protectedValue).toBe(36456);
    expect(linha?.brandModel).toBe('VW - VOLKSWAGEN FOX 1.0 MI TOTAL FLEX 8V 5P');
  });

  it('recusa linha sem código ou com data inválida', () => {
    expect(paraLinha(veiculo({ codigo_veiculo: undefined }), mapaEnderecos, TENANT)).toBeNull();
    expect(paraLinha(veiculo({ data_contrato: 'xx' }), mapaEnderecos, TENANT)).toBeNull();
  });

  // Moto recém-vendida aguardando emplacamento é pendência real: 357 casos na
  // base em 2026-07-22 sumiam da fila quando a placa era obrigatória.
  it('mantém veículo sem placa desde que tenha chassi', () => {
    const linha = paraLinha(veiculo({ placa: '' }), mapaEnderecos, TENANT);
    expect(linha).not.toBeNull();
    expect(linha?.plate).toBe('');
    expect(linha?.chassi).toBe('9BWAA05Z4A4116200');
  });

  it('recusa só quando falta placa E chassi', () => {
    expect(
      paraLinha(veiculo({ placa: '', chassi: '' }), mapaEnderecos, TENANT),
    ).toBeNull();
  });

  it('normaliza placa para caixa alta', () => {
    const linha = paraLinha(veiculo({ placa: 'llb8h47' }), mapaEnderecos, TENANT);
    expect(linha?.plate).toBe('LLB8H47');
  });
});

describe('montarFila', () => {
  it('mantém só pendências de cliente ativo', () => {
    const veiculos = [
      veiculo({ codigo_veiculo: '1', codigo_tipo_adesao: '1' }),
      veiculo({ codigo_veiculo: '2', codigo_tipo_adesao: '10' }),
      // instalado: fora
      veiculo({ codigo_veiculo: '3', codigo_tipo_adesao: '2' }),
      // pendente, mas associado não está entre os ativos: fora
      veiculo({ codigo_veiculo: '4', codigo_tipo_adesao: '1', codigo_associado: '999' }),
    ];

    const fila = montarFila(veiculos, associados, TENANT);

    expect(fila.map((l) => l.hinovaVehicleCode)).toEqual(['1', '2']);
    expect(fila.map((l) => l.pendingType)).toEqual(['TRACKER', 'TAG']);
  });

  it('devolve fila vazia quando não há associado ativo', () => {
    expect(montarFila([veiculo()], [], TENANT)).toEqual([]);
  });
});
