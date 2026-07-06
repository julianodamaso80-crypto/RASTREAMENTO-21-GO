// Diagnóstico de boot DESATIVADO para release de produção.
// Mantido como no-op de propósito: as chamadas diag(...) espalhadas pelo boot
// (_layout, index, login, auth-store) viram no-ops sem precisar mexer nesses
// arquivos sensíveis. Reativar = restaurar o corpo com o fetch pro /diag.
export function diag(_event: string): void {
  // no-op
}
