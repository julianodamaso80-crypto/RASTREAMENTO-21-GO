/**
 * Traduz a falha do login no que o usuário pode fazer a respeito.
 *
 * Só a credencial recusada (401) segue com texto genérico e igual nos dois
 * mundos: variar ali transformaria o app num verificador de quais CPFs são
 * clientes e quais e-mails pertencem ao time — primeiro passo de ataque
 * dirigido. Rede, servidor fora e sessão que não gravou não revelam nada sobre
 * quem existe no cadastro, então essas têm nome próprio: sem isso, servidor
 * inacessível e senha errada chegam ao cliente com a mesma frase e ninguém —
 * nem o suporte — descobre o que aconteceu.
 */
export interface FalhaDeLogin {
  titulo: string;
  texto: string;
}

export function explicarFalhaDeLogin(
  erro: any,
  autenticou: boolean,
): FalhaDeLogin {
  // O servidor já tinha aceitado a credencial: o que quebrou foi guardar a
  // sessão no aparelho. Dizer "senha inválida" aqui manda o cliente conferir
  // justamente o que estava certo.
  if (autenticou) {
    return {
      titulo: 'Entrei, mas não consegui guardar a sessão',
      texto:
        'Seu CPF e senha estão certos, mas este aparelho não deixou salvar o ' +
        'acesso. Tente de novo; se insistir, reinicie o aparelho.',
    };
  }

  const status = erro?.response?.status;
  if (status === 401) {
    // Caso único em que o servidor diz mais: a senha JÁ bateu, mas o cadastro
    // não tem rastreador instalado. Repassar isso não revela nada a quem não
    // tem a senha, e sem isso o cliente acha que errou a senha e tenta de novo
    // pra sempre.
    const mensagem = mensagemDoServidor(erro);
    if (mensagem.includes('Nenhum rastreador instalado')) {
      return { titulo: 'Sem rastreador vinculado', texto: mensagem };
    }
    return {
      titulo: 'Não foi possível entrar',
      texto: 'CPF/e-mail ou senha inválidos. Confira e tente de novo.',
    };
  }
  // Sem `response` = a requisição não chegou a ter resposta: sem internet,
  // DNS, servidor fora ou os 15s de timeout do cliente.
  if (!erro?.response) {
    return {
      titulo: 'Sem conexão com o servidor',
      texto:
        'Não consegui falar com o servidor. Confira a sua internet e tente ' +
        'de novo em instantes.',
    };
  }
  return {
    titulo: 'O servidor não respondeu direito',
    texto: `Deu um problema do nosso lado (erro ${status}). Tente de novo em instantes.`,
  };
}

/** NestJS manda `message` como string ou array de strings (class-validator). */
function mensagemDoServidor(erro: any): string {
  const m = erro?.response?.data?.message;
  if (Array.isArray(m)) return m.join(' ');
  return typeof m === 'string' ? m : '';
}
