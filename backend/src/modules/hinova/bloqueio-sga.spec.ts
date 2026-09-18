import { HinovaService } from './hinova.service';

/**
 * O SGA bloqueia o token por volume ("Token BLOQUEADO temporariamente por
 * excesso de extracao de DADOS") com HTTP 403, e só libera depois de alguns
 * minutos SEM uso. Repetir a chamada durante o bloqueio mantém o token
 * bloqueado — em 18/09/2026 o token compartilhado com o CRM passou a manhã
 * inteira assim e o sync de pendências falhou.
 *
 * Bloqueio não é falha transitória: a varredura para na primeira resposta e
 * repassa a mensagem do SGA para a tela.
 */
describe('bloqueio do token no SGA', () => {
  const bloqueio = {
    response: {
      status: 403,
      data: {
        mensagem: 'Forbidden',
        error: [
          'Token BLOQUEADO temporariamente por excesso de extracao de DADOS. A liberacao ocorrera AUTOMATICAMENTE apos alguns minutos',
        ],
      },
    },
  };

  function montar() {
    const service = new HinovaService({
      get: (chave: string) =>
        ({
          'hinova.baseUrl': 'https://sga.invalido',
          'hinova.token': 'token-integracao',
          'hinova.usuario': 'usuario',
          'hinova.senha': 'senha',
          'hinova.verifySsl': false,
        })[chave],
    } as never);

    let listagens = 0;
    (service as unknown as { client: unknown }).client = {
      post: jest.fn(async (path: string) => {
        if (path === '/usuario/autenticar') {
          return { data: { token_usuario: 'sessao' } };
        }
        listagens++;
        throw bloqueio;
      }),
      get: jest.fn(),
    };
    return { service, listagens: () => listagens };
  }

  it('não repete a listagem enquanto o token está bloqueado', async () => {
    const { service, listagens } = montar();

    await expect(service.listRawActiveVehicles(0, 2000)).rejects.toThrow(
      /Token BLOQUEADO/,
    );
    expect(listagens()).toBe(1);
  });
});
