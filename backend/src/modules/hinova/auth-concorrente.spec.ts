import { HinovaService } from './hinova.service';

/**
 * Com as duas varreduras rodando em paralelo, a autenticação virou recurso
 * compartilhado.
 *
 * O SGA mantém uma sessão por usuário: autenticar de novo invalida o
 * `token_usuario` anterior (medido em 03/09/2026 — um token que respondia 200
 * passou a devolver 401 assim que outra autenticação com o mesmo usuário
 * aconteceu). Se veículos e associados tomam 401 ao mesmo tempo e cada um
 * chama `authenticate()` por conta própria, o segundo login derruba o token
 * que o primeiro acabou de guardar, e os dois entram num vaivém de 401 que só
 * termina quando as 8 tentativas do retry se esgotam.
 *
 * Uma autenticação em voo por vez: quem chega no meio espera a mesma promessa.
 */
describe('autenticação concorrente no SGA', () => {
  it('duas chamadas simultâneas fazem UM login só', async () => {
    let logins = 0;
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

    // Dublê do axios: conta os POSTs de autenticação.
    (service as unknown as { client: unknown }).client = {
      post: jest.fn(async (path: string) => {
        if (path === '/usuario/autenticar') {
          logins++;
          await new Promise((r) => setTimeout(r, 100));
          return { data: { token_usuario: `sessao-${logins}` } };
        }
        return { data: {} };
      }),
      get: jest.fn(async () => ({ data: {} })),
    };

    await Promise.all([
      service.authenticate(),
      service.authenticate(),
      service.authenticate(),
    ]);

    expect(logins).toBe(1);
  });
});
