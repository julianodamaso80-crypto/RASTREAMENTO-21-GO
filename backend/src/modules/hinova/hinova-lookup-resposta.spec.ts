import { HinovaService } from './hinova.service';

/**
 * O endpoint /buscar/situacao-financeira-veiculo/{ident} do SGA compara o
 * identificador também com o `codigo_veiculo`, depois de um cast numérico
 * implícito: "9C2KC2210TR110253" casa o veículo de código 9.
 *
 * Como TODO chassi brasileiro começa por dígito (9BD, 9C2, 93Y...), consultar
 * por chassi voltava com o cadastro de um associado qualquer — e o vínculo do
 * estoque instalava o rastreador no cliente errado. Verificado contra o SGA de
 * produção em 20/08/2026:
 *
 *   9C2KC2210TR110253 → codigo_veiculo 9  (FREDERICK … / RJU0F75 / INATIVO)
 *   93Y4SRZH5NJ124372 → codigo_veiculo 93 (ROGERIO …  / OMA1J52)
 *
 * A resposta só vale se for do veículo que foi pedido.
 */

const RESPOSTA_DE_OUTRO_VEICULO = [
  {
    cpf: '13118403705',
    nome: 'FREDERICK NELSON VITILIO LOPES SEGUNDO',
    codigo_veiculo: '9',
    placa: 'RJU0F75',
    chassi: '9BD19713NM3387209',
    codigo_modelo: '7779',
    descricao_modelo: 'GRAND SIENA 1.0 EVO FLEX 8V 4P',
    codigo_situacao_veiculo: '2',
    descricao_situacao_veiculo: 'INATIVO',
    situacao_financeira: 'INADIMPLENTE',
    data_vencimento: '2025-06-10',
  },
];

function servico(resposta: unknown) {
  const s = new HinovaService({
    get: (chave: string) =>
      ({
        'hinova.baseUrl': 'https://api.example.test',
        'hinova.token': 'token',
        'hinova.usuario': 'usuario',
        'hinova.senha': 'senha',
        'hinova.verifySsl': true,
      })[chave],
  } as never);

  // Curto-circuita a rede: autenticação já feita e GET devolvendo o corpo fixo.
  (s as unknown as { tokenUsuario: string }).tokenUsuario = 'sessao';
  const get = jest.fn().mockResolvedValue(resposta);
  (s as unknown as { get: unknown }).get = get;
  return { s, get };
}

describe('HinovaService.lookupByPlate — a resposta tem que ser do veículo pedido', () => {
  it('chassi que o SGA respondeu com outro veículo: trata como não encontrado', async () => {
    const { s } = servico(RESPOSTA_DE_OUTRO_VEICULO);
    const r = await s.lookupByPlate('9C2KC2210TR110253');

    expect(r.encontrado).toBe(false);
    // Nada do cadastro alheio pode vazar pro vínculo.
    expect(r.cliente.nome).toBeNull();
    expect(r.cliente.cpf).toBeNull();
    expect(r.veiculo.placa).toBeNull();
  });

  it('placa pedida bate com a placa respondida: usa a resposta', async () => {
    const { s } = servico(RESPOSTA_DE_OUTRO_VEICULO);
    const r = await s.lookupByPlate('rju0f75');

    expect(r.encontrado).toBe(true);
    expect(r.veiculo.placa).toBe('RJU0F75');
    expect(r.ativo).toBe(false); // situação 2 = INATIVO
  });

  it('chassi pedido bate com o chassi respondido: usa a resposta', async () => {
    const { s } = servico(RESPOSTA_DE_OUTRO_VEICULO);
    const r = await s.lookupByPlate('9BD19713NM3387209');

    expect(r.encontrado).toBe(true);
    expect(r.veiculo.chassi).toBe('9BD19713NM3387209');
  });
});
