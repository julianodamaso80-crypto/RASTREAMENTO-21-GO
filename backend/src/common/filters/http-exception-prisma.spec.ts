import { HttpExceptionFilter } from './http-exception.filter';

/**
 * Erro de banco não pode chegar ao operador como "Erro interno do servidor".
 *
 * Foi assim que o vínculo do IMEI 866557086559061 falhou seis vezes entre 24 e
 * 26/08/2026 sem ninguém entender por quê: o Prisma estourava
 * `vehicles_unique_id_key` e a tela só dizia "Erro interno do servidor". A
 * mensagem tem que nomear o conflito — é o que transforma um chamado de dias
 * num diagnóstico de minutos.
 */

function contexto() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  };
  return { host, status, json };
}

function erroPrisma(code: string, meta?: Record<string, unknown>) {
  const e = new Error('Invalid `prisma.vehicle.create()` invocation') as Error & {
    code?: string;
    meta?: Record<string, unknown>;
  };
  e.name = 'PrismaClientKnownRequestError';
  e.code = code;
  e.meta = meta;
  return e;
}

describe('HttpExceptionFilter — erro de banco', () => {
  it('conflito de unicidade vira 409 dizendo qual campo já está em uso', () => {
    const { host, status, json } = contexto();

    new HttpExceptionFilter().catch(
      erroPrisma('P2002', { target: ['unique_id'] }),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(409);
    const corpo = json.mock.calls[0][0] as { message: string };
    expect(corpo.message).toMatch(/unique_id/);
    expect(corpo.message).not.toMatch(/Erro interno do servidor/);
  });

  it('conflito sem lista de campos ainda diz que é duplicidade', () => {
    const { host, status, json } = contexto();

    new HttpExceptionFilter().catch(
      erroPrisma('P2002', { target: 'vehicles_unique_id_key' }),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect((json.mock.calls[0][0] as { message: string }).message).toMatch(
      /vehicles_unique_id_key/,
    );
  });

  it('erro sem código conhecido continua 500 genérico', () => {
    const { host, status, json } = contexto();

    new HttpExceptionFilter().catch(new Error('boom'), host as never);

    expect(status).toHaveBeenCalledWith(500);
    expect((json.mock.calls[0][0] as { message: string }).message).toBe(
      'Erro interno do servidor',
    );
  });
});
