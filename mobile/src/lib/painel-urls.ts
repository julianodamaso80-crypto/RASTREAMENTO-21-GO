export const PAINEL_ORIGIN = 'https://trackgo.site';
const PAINEL_HOST = 'trackgo.site';
const RE_AUTORIDADE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#\\]*)/;

/**
 * A URL pertence ao painel? Compara ESQUEMA e HOST, nunca prefixo de string —
 * prefixo deixaria passar `trackgo.site.evil.com` e `trackgo.site@evil.com`
 * (host real `evil.com`). Não usa `URL` porque o polyfill do React Native
 * normaliza diferente do Node, e o teste rodaria contra outra implementação
 * que não a do aparelho.
 */
export function ehDoPainel(url: string): boolean {
  const s = url ?? '';
  const m = RE_AUTORIDADE.exec(s);
  if (!m) return false;
  const [inteira, esquema, autoridade] = m;
  if (autoridade.includes('@')) return false; // userinfo: o host real vem depois
  // A autoridade capturada para de ler no primeiro `\` (fora da classe de
  // caracteres). Se sobrar um `\` colado logo ali, o resto da string
  // (ex.: `@evil.com`) nunca foi examinado — parsers divergem sobre o que
  // vem depois, então trata como origem ambígua e recusa.
  if (s[inteira.length] === '\\') return false;
  const host = autoridade.toLowerCase().replace(/:443$/, '');
  return esquema.toLowerCase() === 'https' && host === PAINEL_HOST;
}

/** É a tela de login do painel? Tolera barra final, query string e hash. */
export function ehLoginDoPainel(url: string): boolean {
  if (!ehDoPainel(url)) return false;
  const caminho = url
    .replace(RE_AUTORIDADE, '')
    .split(/[?#]/)[0]
    .replace(/\/+$/, '');
  return caminho === '/login';
}
