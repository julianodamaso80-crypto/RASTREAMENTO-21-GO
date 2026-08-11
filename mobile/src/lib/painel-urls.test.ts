import { PAINEL_ORIGIN, ehDoPainel, ehLoginDoPainel } from './painel-urls';

describe('ehDoPainel', () => {
  it('origem exata é do painel', () => {
    expect(ehDoPainel('https://trackgo.site')).toBe(true);
  });

  it('origem com barra final é do painel', () => {
    expect(ehDoPainel('https://trackgo.site/')).toBe(true);
  });

  it('caminho dentro da origem é do painel', () => {
    expect(ehDoPainel('https://trackgo.site/veiculos')).toBe(true);
  });

  it('tela de login também é do painel', () => {
    expect(ehDoPainel('https://trackgo.site/login')).toBe(true);
  });

  it('subdomínio forjado do atacante não é do painel', () => {
    expect(ehDoPainel('https://trackgo.site.evil.com')).toBe(false);
  });

  it('subdomínio forjado com caminho de login não é do painel', () => {
    expect(ehDoPainel('https://trackgo.site.evil.com/login')).toBe(false);
  });

  it('userinfo forjado não é do painel (host real é evil.com)', () => {
    expect(ehDoPainel('https://trackgo.site@evil.com')).toBe(false);
  });

  it('domínio parecido não é do painel', () => {
    expect(ehDoPainel('https://trackgo.sitex.com')).toBe(false);
  });

  it('http sem TLS não é do painel', () => {
    expect(ehDoPainel('http://trackgo.site')).toBe(false);
  });

  it('domínio totalmente diferente não é do painel', () => {
    expect(ehDoPainel('https://evil.com')).toBe(false);
  });

  it('string vazia não é do painel', () => {
    expect(ehDoPainel('')).toBe(false);
  });

  it('porta 443 explícita ainda é o painel', () => {
    expect(ehDoPainel('https://trackgo.site:443/veiculos')).toBe(true);
  });

  it('esquema e host em maiúsculas ainda são o painel', () => {
    expect(ehDoPainel('HTTPS://TRACKGO.SITE/veiculos')).toBe(true);
  });

  it('barra invertida antes do userinfo não passa (autoridade ambígua)', () => {
    expect(ehDoPainel('https://trackgo.site\\@evil.com')).toBe(false);
  });

  it('esquema blob: não é o painel', () => {
    expect(ehDoPainel('blob:https://trackgo.site/abc')).toBe(false);
  });

  it('esquema data: não é o painel', () => {
    expect(ehDoPainel('data:text/html,<b>x</b>')).toBe(false);
  });

  it('esquema javascript: não é o painel', () => {
    expect(ehDoPainel('javascript:alert(1)')).toBe(false);
  });

  it('URL relativa a protocolo (//host) não é o painel', () => {
    expect(ehDoPainel('//trackgo.site/x')).toBe(false);
  });
});

describe('ehLoginDoPainel', () => {
  it('raiz do painel não é login', () => {
    expect(ehLoginDoPainel('https://trackgo.site')).toBe(false);
  });

  it('raiz com barra final não é login', () => {
    expect(ehLoginDoPainel('https://trackgo.site/')).toBe(false);
  });

  it('rota de veículos não é login', () => {
    expect(ehLoginDoPainel('https://trackgo.site/veiculos')).toBe(false);
  });

  it('caminho /login é login', () => {
    expect(ehLoginDoPainel('https://trackgo.site/login')).toBe(true);
  });

  it('/login com query string é login', () => {
    expect(ehLoginDoPainel('https://trackgo.site/login?next=/x')).toBe(true);
  });

  it('/login com hash é login', () => {
    expect(ehLoginDoPainel('https://trackgo.site/login#a')).toBe(true);
  });

  it('/login/ com barra final é login', () => {
    expect(ehLoginDoPainel('https://trackgo.site/login/')).toBe(true);
  });

  it('/login/ com barra final e query string é login', () => {
    expect(ehLoginDoPainel('https://trackgo.site/login/?x=1')).toBe(true);
  });

  it('porta 443 explícita não é login (caminho é /veiculos)', () => {
    expect(ehLoginDoPainel('https://trackgo.site:443/veiculos')).toBe(false);
  });

  it('maiúsculas em /veiculos não é login', () => {
    expect(ehLoginDoPainel('HTTPS://TRACKGO.SITE/veiculos')).toBe(false);
  });

  it('maiúsculas em /login é login', () => {
    expect(ehLoginDoPainel('HTTPS://TRACKGO.SITE/login')).toBe(true);
  });

  it('barra invertida antes do userinfo não é login', () => {
    expect(ehLoginDoPainel('https://trackgo.site\\@evil.com')).toBe(false);
  });

  it('/loginx não é login (prefixo, não caminho exato)', () => {
    expect(ehLoginDoPainel('https://trackgo.site/loginx')).toBe(false);
  });

  it('/x/login não é login (login não é o caminho inteiro)', () => {
    expect(ehLoginDoPainel('https://trackgo.site/x/login')).toBe(false);
  });

  it('esquema blob: não é login', () => {
    expect(ehLoginDoPainel('blob:https://trackgo.site/abc')).toBe(false);
  });

  it('esquema data: não é login', () => {
    expect(ehLoginDoPainel('data:text/html,<b>x</b>')).toBe(false);
  });

  it('esquema javascript: não é login', () => {
    expect(ehLoginDoPainel('javascript:alert(1)')).toBe(false);
  });

  it('URL relativa a protocolo (//host) não é login', () => {
    expect(ehLoginDoPainel('//trackgo.site/x')).toBe(false);
  });

  it('subdomínio forjado com /login não é login (não é do painel)', () => {
    expect(ehLoginDoPainel('https://trackgo.site.evil.com/login')).toBe(false);
  });

  it('userinfo forjado não é login', () => {
    expect(ehLoginDoPainel('https://trackgo.site@evil.com')).toBe(false);
  });

  it('domínio parecido não é login', () => {
    expect(ehLoginDoPainel('https://trackgo.sitex.com')).toBe(false);
  });

  it('http sem TLS não é login', () => {
    expect(ehLoginDoPainel('http://trackgo.site')).toBe(false);
  });

  it('domínio diferente não é login', () => {
    expect(ehLoginDoPainel('https://evil.com')).toBe(false);
  });

  it('string vazia não é login', () => {
    expect(ehLoginDoPainel('')).toBe(false);
  });

  it('a origem exportada é a mesma usada nos testes', () => {
    expect(PAINEL_ORIGIN).toBe('https://trackgo.site');
  });
});
