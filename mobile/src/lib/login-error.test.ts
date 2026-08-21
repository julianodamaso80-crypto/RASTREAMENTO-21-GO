import { explicarFalhaDeLogin } from './login-error';

describe('explicarFalhaDeLogin', () => {
  it('credencial recusada continua genérica nos dois mundos', () => {
    const r = explicarFalhaDeLogin({ response: { status: 401 } }, false);
    expect(r.texto).toContain('CPF/e-mail ou senha inválidos');
  });

  it('sem resposta do servidor não vira "senha inválida"', () => {
    const r = explicarFalhaDeLogin({ message: 'Network Error' }, false);
    expect(r.titulo).toBe('Sem conexão com o servidor');
    expect(r.texto).not.toContain('senha');
  });

  it('timeout do axios cai no aviso de conexão, não no de credencial', () => {
    const r = explicarFalhaDeLogin({ code: 'ECONNABORTED' }, false);
    expect(r.titulo).toBe('Sem conexão com o servidor');
  });

  it('erro do servidor mostra o status em vez de culpar a senha', () => {
    const r = explicarFalhaDeLogin({ response: { status: 502 } }, false);
    expect(r.texto).toContain('502');
  });

  it('falha depois de autenticar não manda conferir a senha certa', () => {
    const r = explicarFalhaDeLogin(new Error('SecureStore falhou'), true);
    expect(r.texto).toContain('estão certos');
  });

  it('401 por falta de rastreador instalado mostra a orientação do servidor, não "senha inválida"', () => {
    const r = explicarFalhaDeLogin(
      {
        response: {
          status: 401,
          data: {
            message:
              'Nenhum rastreador instalado vinculado ao seu CPF. Fale com a sua associação.',
          },
        },
      },
      false,
    );
    expect(r.titulo).toBe('Sem rastreador vinculado');
    expect(r.texto).toContain('Fale com a sua associação');
    expect(r.texto).not.toContain('senha');
  });

  it('401 com qualquer outra mensagem continua genérico (não vira verificador de CPF)', () => {
    const r = explicarFalhaDeLogin(
      { response: { status: 401, data: { message: 'Associado não encontrado' } } },
      false,
    );
    expect(r.texto).toContain('CPF/e-mail ou senha inválidos');
  });
});
