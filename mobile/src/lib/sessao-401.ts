/**
 * Decide se um 401 significa "a sessão morreu" (aí o app desloga) ou só "o
 * servidor recusou ESTA operação" (aí a tela mostra o motivo e segue).
 *
 * Até 30/09/2026 qualquer 401 deslogava. A auditoria dos logs mostrou o
 * estrago: o cliente criava a senha (201), a tela não saía do lugar, ele
 * apertava de novo 15 s depois, o backend respondia 401 "Senha atual
 * incorreta" (o CPF já não valia) e o app o jogava para fora — 67 de 73
 * pessoas em um dia. Muitos voltavam ao login digitando o CPF e recebiam
 * "CPF ou senha inválidos".
 *
 * Só as rotas de credencial escapam: nelas o 401 é resposta ao que a pessoa
 * digitou, não ao token.
 */
const ROTAS_DE_CREDENCIAL = [
  /\/auth\/login\/?$/,
  /\/auth\/change-password\/?$/,
  /\/auth\/forgot-password\/?$/,
  /\/auth\/reset-password\/?$/,
];

export function deveDeslogarPor401(url: string | undefined): boolean {
  if (!url) return true;
  const semQuery = url.split('?')[0];
  return !ROTAS_DE_CREDENCIAL.some((r) => r.test(semQuery));
}
