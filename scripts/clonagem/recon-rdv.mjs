#!/usr/bin/env node
/**
 * Reconhecimento de uma tela da plataforma de origem (RedeVeiculos), para
 * copiá-la aqui sem achismo.
 *
 * O método veio de duas skills de clonagem do GitHub, ambas MIT:
 *   - JCodesMore/ai-website-cloner-template (.claude/skills/clone-website)
 *   - Jane-xiaoer/claude-skill-web-clone
 * Nenhuma das duas serve como está: as duas clonam site PÚBLICO de marketing
 * (uma delas exclui "login, permissão e lógica de servidor" no próprio escopo).
 * O que aproveitei foi a disciplina: capturar valor exato, não impressão —
 * `getComputedStyle` em vez de "parece 16px", e cada estado, não só o inicial.
 *
 * A diferença do nosso caso: num painel de operação o que importa não é imagem
 * de fundo, é **campo, opção de select, rótulo, endpoint e regra**. É isso que
 * este script arranca.
 *
 * Uso:
 *   RDV_USER=... RDV_PASS=... node scripts/clonagem/recon-rdv.mjs \
 *     --rota /agendamentos/ --saida docs/clonagem/agendamentos
 *
 *   --clicar "<seletor>"  varre cliques NOS ELEMENTOS DESSE SELETOR (abas).
 *                         Fora isso o script não clica em nada: é a conta real
 *                         do dono num sistema em produção — clique errado
 *                         apaga OS de verdade.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.RDV_BASE || 'https://21go.rastreamento.vip';
const LARGURAS = [
  ['desktop', 1440],
  ['tablet', 768],
  ['mobile', 390],
];

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

function args(argv) {
  const o = { rota: '/', saida: 'docs/clonagem/tela', clicar: '', esperar: 8000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--rota') o.rota = argv[++i];
    else if (a === '--saida') o.saida = argv[++i];
    else if (a === '--clicar') o.clicar = argv[++i];
    else if (a === '--esperar') o.esperar = Number(argv[++i]);
    else throw new Error(`Argumento desconhecido: ${a}`);
  }
  return o;
}

/** Campos, opções e rótulos — o que precisamos para reproduzir a tela. */
const INVENTARIO = () => ({
  titulo: document.title,
  abas: [...document.querySelectorAll('[role="tab"], .nav-link, .nav-item a')]
    .map((e) => e.innerText.trim().replace(/\s+/g, ' '))
    .filter(Boolean),
  selects: [...document.querySelectorAll('select')].map((s) => ({
    id: s.id,
    name: s.name,
    multiplo: s.multiple,
    opcoes: [...s.options].map((o) => [o.value, o.textContent.trim()]),
  })),
  campos: [...document.querySelectorAll('input, textarea')].map((i) => ({
    id: i.id,
    name: i.name,
    tipo: i.type,
    placeholder: i.placeholder,
    valor: i.type === 'password' ? '' : String(i.value).slice(0, 40),
    desabilitado: i.disabled,
  })),
  botoes: [...document.querySelectorAll('button, a.btn, .btn')]
    .map((b) => ({
      texto: b.innerText.trim().replace(/\s+/g, ' ').slice(0, 60),
      onclick: (b.getAttribute('onclick') || '').slice(0, 200),
    }))
    .filter((b) => b.texto),
  rotulos: [...document.querySelectorAll('label, h1, h2, h3, h4, h5, h6, th')]
    .map((e) => e.innerText.trim().replace(/\s+/g, ' '))
    .filter(Boolean),
  tabelas: [...document.querySelectorAll('table')].map((t) => ({
    colunas: [...t.querySelectorAll('thead th')].map((th) => th.innerText.trim()),
    linhas: t.querySelectorAll('tbody tr').length,
  })),
  scripts: [...document.querySelectorAll('script[src]')]
    .map((s) => s.getAttribute('src'))
    .filter((s) => s && !/jquery|bootstrap|moment|chart|fontawesome/i.test(s)),
});

/** Valor exato de CSS, como as skills mandam — nunca "parece 16px". */
const ESTILOS = (seletor) => {
  const props = [
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
    'color', 'backgroundColor', 'backgroundImage', 'textAlign', 'textTransform',
    'padding', 'margin', 'width', 'height', 'display', 'flexDirection',
    'justifyContent', 'alignItems', 'gap', 'gridTemplateColumns',
    'borderRadius', 'border', 'boxShadow', 'position', 'zIndex', 'opacity',
  ];
  const limpa = (el) => {
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of props) {
      const v = cs[p];
      if (v && !['none', 'normal', 'auto', '0px', 'rgba(0, 0, 0, 0)'].includes(v)) o[p] = v;
    }
    return o;
  };
  const anda = (el, nivel) => {
    if (nivel > 3) return null;
    return {
      tag: el.tagName.toLowerCase(),
      classes: (el.className?.toString() || '').split(' ').slice(0, 4).join(' '),
      texto:
        el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
          ? el.textContent.trim().slice(0, 120)
          : null,
      estilos: limpa(el),
      filhos: [...el.children].slice(0, 25).map((f) => anda(f, nivel + 1)).filter(Boolean),
    };
  };
  const raiz = document.querySelector(seletor) || document.body;
  return anda(raiz, 0);
};

(async () => {
  const o = args(process.argv.slice(2));
  if (!process.env.RDV_USER || !process.env.RDV_PASS) {
    console.error('Faltou RDV_USER e RDV_PASS no ambiente.');
    process.exit(1);
  }
  const saida = path.resolve(o.saida);
  fs.mkdirSync(path.join(saida, 'telas'), { recursive: true });

  const navegador = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
    userDataDir: path.join(os.tmpdir(), 'recon-rdv-perfil'),
  });
  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1440, height: 1000 });

  const rede = [];
  const erros = [];
  pagina.on('console', (m) => m.type() === 'error' && erros.push(m.text().slice(0, 200)));
  pagina.on('response', async (r) => {
    const u = r.url();
    if (!/Controller|controller/.test(u)) return;
    try {
      const t = await r.text();
      rede.push({ url: u.replace(BASE, ''), status: r.status(), corpo: t.slice(0, 4000) });
    } catch {
      /* resposta sem corpo legível */
    }
  });

  await pagina.goto(BASE + o.rota, { waitUntil: 'networkidle2', timeout: 90000 });
  if (pagina.url().includes('login')) {
    await pagina.type('input[name="auth_user"]', process.env.RDV_USER);
    await pagina.type('input[name="auth_pw"]', process.env.RDV_PASS);
    await Promise.all([
      pagina.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
      pagina.keyboard.press('Enter'),
    ]);
    await dorme(4000);
    await pagina.goto(BASE + o.rota, { waitUntil: 'networkidle2', timeout: 90000 });
  }
  await dorme(o.esperar);
  if (pagina.url().includes('login')) {
    console.error('Login não passou — confira RDV_USER/RDV_PASS.');
    await navegador.close();
    process.exit(1);
  }

  // Fecha o aviso de contrato, que cobre a tela a cada poucos minutos.
  await pagina.evaluate(() => {
    document.querySelectorAll('.modal.show .close, .modal.show [data-dismiss="modal"]').forEach((b) => b.click());
  });
  await dorme(600);

  const escreve = (nome, dados) =>
    fs.writeFileSync(
      path.join(saida, nome),
      typeof dados === 'string' ? dados : JSON.stringify(dados, null, 1),
      'utf8',
    );

  for (const [nome, largura] of LARGURAS) {
    await pagina.setViewport({ width: largura, height: 1000 });
    await dorme(1200);
    await pagina.screenshot({ path: path.join(saida, 'telas', `${nome}.png`), fullPage: true });
  }
  await pagina.setViewport({ width: 1440, height: 1000 });
  await dorme(800);

  escreve('inventario.json', await pagina.evaluate(INVENTARIO));
  escreve('estilos.json', await pagina.evaluate(ESTILOS, 'body'));
  escreve('texto.txt', await pagina.evaluate(() => document.body.innerText));
  escreve('html.html', await pagina.content());

  // Varredura de abas: só com --clicar, e só nos elementos do seletor.
  if (o.clicar) {
    const abas = await pagina.$$(o.clicar);
    console.log('abas encontradas:', abas.length);
    for (let i = 0; i < abas.length; i += 1) {
      const nome = await abas[i].evaluate((e) => (e.innerText || e.id || 'aba').trim().replace(/\W+/g, '-').slice(0, 30));
      await abas[i].evaluate((e) => e.click());
      await dorme(3500);
      await pagina.screenshot({ path: path.join(saida, 'telas', `aba-${i}-${nome}.png`), fullPage: true });
      escreve(`aba-${i}-${nome}.json`, await pagina.evaluate(INVENTARIO));
    }
  }

  escreve('rede.json', rede);
  escreve('console-erros.json', erros);

  const inv = JSON.parse(fs.readFileSync(path.join(saida, 'inventario.json'), 'utf8'));
  console.log('--- recon de', o.rota);
  console.log('abas:', inv.abas.length, '| selects:', inv.selects.length, '| campos:', inv.campos.length, '| botões:', inv.botoes.length);
  console.log('endpoints capturados:', [...new Set(rede.map((r) => r.url.split('?')[0]))].length);
  console.log('saída em', saida);
  await navegador.close();
})();
