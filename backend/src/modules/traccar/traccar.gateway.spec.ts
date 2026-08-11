import { TraccarGateway } from './traccar.gateway';

/**
 * Fronteira dos três mundos DENTRO do WebSocket.
 *
 * O gateway é o único ponto do sistema em que painel, app do cliente e PWA do
 * técnico chegam pelo mesmo socket. Errar o roteamento aqui não devolve um 403
 * — devolve a posição em tempo real da frota inteira pra quem não deveria vê-la.
 *
 * Os mocks de `JwtService`/`ConfigService` são feitos como em
 * `modules/app/guards/associate-jwt.guard.spec.ts`: `config.get` devolve a
 * própria chave, então o teste consegue provar QUAL segredo foi pedido — não só
 * que a conexão deu certo.
 */

interface TokenFalso {
  type?: string;
  sub?: string;
  tenantId?: string;
  email?: string;
  name?: string;
  /** Segredo com que este token foi "assinado" — o verify falso confere. */
  assinadoCom: string;
}

const SEGREDO_INTERNO = 'jwt.secret';
const SEGREDO_ASSOCIADO = 'jwt.associateSecret';

function montar(token: TokenFalso | null) {
  // `decode` devolve o payload sem conferir nada — igual ao JwtService real.
  // `verify` só devolve o payload se o segredo pedido bater com o que
  // "assinou" o token; caso contrário lança, como a lib faz de verdade.
  const jwt = {
    decode: jest.fn(() => token),
    verify: jest.fn((_t: string, opts: { secret: string }) => {
      if (!token || opts.secret !== token.assinadoCom) {
        throw new Error('invalid signature');
      }
      return token;
    }),
  };
  const config = { get: jest.fn((chave: string) => chave) };

  const gateway = new TraccarGateway(
    jwt as any,
    config as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const client = {
    handshake: {
      auth: { token: 'qualquer-coisa' } as { token?: string },
      headers: {} as { authorization?: string },
    },
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    disconnect: jest.fn(),
  };

  return { gateway, client, jwt, config };
}

describe('TraccarGateway — roteamento dos mundos no handshake', () => {
  it('token de associado entra só na sala do associado, nunca na do tenant', async () => {
    const { gateway, client } = montar({
      type: 'associate',
      sub: 'assoc-1',
      tenantId: 't1',
      name: 'Cliente',
      assinadoCom: SEGREDO_ASSOCIADO,
    });

    await gateway.handleConnection(client as any);

    expect(client.join).toHaveBeenCalledWith('associate:assoc-1');
    expect(client.join).not.toHaveBeenCalledWith('tenant:t1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('token de associado é verificado com o segredo do associado, não com o do painel', async () => {
    const { gateway, client, jwt, config } = montar({
      type: 'associate',
      sub: 'assoc-1',
      assinadoCom: SEGREDO_ASSOCIADO,
    });

    await gateway.handleConnection(client as any);

    expect(config.get).toHaveBeenCalledWith('jwt.associateSecret');
    const [, opts] = jwt.verify.mock.calls[0];
    expect(opts.secret).toBe(SEGREDO_ASSOCIADO);
  });

  it('token de usuário do painel entra na sala do tenant com o segredo interno', async () => {
    const { gateway, client, jwt, config } = montar({
      type: 'user',
      sub: 'u1',
      tenantId: 't1',
      email: 'op@21go.com.br',
      assinadoCom: SEGREDO_INTERNO,
    });

    await gateway.handleConnection(client as any);

    expect(config.get).toHaveBeenCalledWith('jwt.secret');
    const [, opts] = jwt.verify.mock.calls[0];
    expect(opts.secret).toBe(SEGREDO_INTERNO);
    expect(client.join).toHaveBeenCalledWith('tenant:t1');
    expect(client.data.tenantId).toBe('t1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('token de técnico é desconectado e não entra em sala nenhuma', async () => {
    // O PWA do técnico não usa WebSocket. Entrar na sala do tenant entregaria
    // a frota inteira a quem autentica só com CPF + senha provisória.
    const { gateway, client } = montar({
      type: 'technician',
      sub: 'tec-1',
      tenantId: 't1',
      assinadoCom: SEGREDO_INTERNO,
    });

    await gateway.handleConnection(client as any);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('token legado sem type entra na sala do tenant (compatibilidade de rollout)', async () => {
    const { gateway, client } = montar({
      sub: 'u1',
      tenantId: 't1',
      email: 'antigo@21go.com.br',
      assinadoCom: SEGREDO_INTERNO,
    });

    await gateway.handleConnection(client as any);

    expect(client.join).toHaveBeenCalledWith('tenant:t1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('token de painel sem tenantId é desconectado', async () => {
    const { gateway, client } = montar({
      type: 'user',
      sub: 'u1',
      assinadoCom: SEGREDO_INTERNO,
    });

    await gateway.handleConnection(client as any);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('type desconhecido é desconectado (nada entra por default)', async () => {
    const { gateway, client } = montar({
      type: 'robo',
      sub: 'x',
      tenantId: 't1',
      assinadoCom: SEGREDO_INTERNO,
    });

    await gateway.handleConnection(client as any);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('assinatura inválida é desconectada — o decode não autentica ninguém', async () => {
    // Payload diz `type: 'associate'`, mas foi assinado com outro segredo:
    // o verify precisa recusar mesmo com o decode já tendo lido o type.
    const { gateway, client } = montar({
      type: 'associate',
      sub: 'assoc-1',
      assinadoCom: 'segredo-de-atacante',
    });

    await gateway.handleConnection(client as any);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('token de associado assinado com o segredo do painel é recusado', async () => {
    const { gateway, client } = montar({
      type: 'associate',
      sub: 'assoc-1',
      tenantId: 't1',
      assinadoCom: SEGREDO_INTERNO,
    });

    await gateway.handleConnection(client as any);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('handshake sem token é desconectado', async () => {
    const { gateway, client } = montar(null);
    client.handshake.auth = {};

    await gateway.handleConnection(client as any);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });
});
