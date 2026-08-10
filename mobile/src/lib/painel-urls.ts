export const PAINEL_ORIGIN = 'https://trackgo.site';

/**
 * A URL pertence ao painel? Compara ORIGEM (protocolo + host), nunca prefixo
 * de string — prefixo deixaria passar subdomínio de atacante
 * (`trackgo.site.evil.com`) e URL com userinfo (`trackgo.site@evil.com`, onde
 * o host real é `evil.com`).
 */
export function ehDoPainel(url: string): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === PAINEL_ORIGIN;
  } catch {
    return false;
  }
}

/** É a tela de login do painel? (com ou sem query string / hash) */
export function ehLoginDoPainel(url: string): boolean {
  if (!ehDoPainel(url)) return false;
  try {
    return new URL(url).pathname === '/login';
  } catch {
    return false;
  }
}
