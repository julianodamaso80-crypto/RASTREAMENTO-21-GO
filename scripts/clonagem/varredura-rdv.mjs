#!/usr/bin/env node
/**
 * Varredura de TODOS os módulos do menu da plataforma de origem, para saber o
 * que eles têm — o insumo da auditoria competitiva.
 *
 * É SÓ LEITURA, e isso não é detalhe: roda na conta real do dono, num sistema
 * em produção com 22 mil ativos. O que o script faz em cada módulo:
 *   abre a URL → espera carregar → fecha o aviso de contrato → tira uma foto →
 *   lista campos, filtros, opções e endpoints → espera e vai pro próximo.
 *
 * O que ele NUNCA faz: clicar em botão, enviar formulário, exportar, abrir
 * menu de ação, mudar filtro. Clique nenhum fora do "fechar" do aviso.
 *
 * Uso:
 *   MSYS_NO_PATHCONV=1 RDV_USER=... RDV_PASS=... \
 *     node scripts/clonagem/varredura-rdv.mjs --saida docs/clonagem/varredura
 *   [--rotas /guardiao/,/antifraude/]   subconjunto, para testar
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

/** Os 24 itens internos do menu deles (medido em 11/09/2026). */
const MODULOS = [
  ['Conectividade', '/dashboard/'],
  ['Alertas', '/alertas/'],
  ['Acionamentos', '/acionamentos/'],
  ['Mapa', '/rastreamento/'],
  ['Guardião', '/guardiao/'],
  ['Tratativa de Alertas', '/tratativaAlertas/'],
  ['Antifraude', '/antifraude/'],
  ['Áreas de risco', '/areaDeRisco/'],
  ['Ativos', '/veiculos/'],
  ['Grupos', '/grupos/'],
  ['Estoque', '/equipamentosDisponiveis/'],
  ['Chips', '/chips/'],
  ['SMS Comandos', '/smsComandos/'],
  ['Agendamentos', '/agendamentos/'],
  ['Técnicos', '/tecnicos/'],
  ['Prestadores de Serviços', '/prontasRespostas/'],
  ['Clientes', '/clientes/'],
  ['Consultores', '/consultores/'],
  ['Carteira Virtual', '/carteiraVirtual/'],
  ['Registro de Atividades', '/auditoria/'],
  ['Configurações', '/configuracoes/'],
  ['Usuários', '/configuracoes/logins'],
  ['Config. de agendamentos', '/configuracoes/config_agendamentos/'],
  ['Vídeos', '/videos/'],
];

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

function args(argv) {
  const o = { saida: 'docs/clonagem/varredura', rotas: '', espera: 9000, intervalo: 3000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--saida') o.saida = argv[++i];
    else if (a === '--rotas') o.rotas = argv[++i];
    else if (a === '--espera') o.espera = Number(argv[++i]);
    else if (a === '--intervalo') o.intervalo = Number(argv[++i]);
    else throw new Error(`Argumento desconhecido: ${a}`);
  }
  return o;
}

/** O que precisamos saber de cada tela: campo, filtro, opção, contagem. */
const INVENTARIO = () => {
  const txt = (e) => (e.innerText || '').trim().replace(/\s+/g, ' ');
  return {
    titulo: document.title,
    h1: [...document.querySelectorAll('h1,h2,h3,h4,h5')].map(txt).filter(Boolean).slice(0, 25),
    abas: [...document.querySelectorAll('[role="tab"], .nav-tabs .nav-link, .nav-pills .nav-link')]
      .map(txt)
      .filter(Boolean),
    selects: [...document.querySelectorAll('select')].map((s) => ({
      id: s.id || s.name,
      opcoes: [...s.options].map((o) => o.textContent.trim()).slice(0, 30),
    })),
    campos: [...document.querySelectorAll('input, textarea')]
      .filter((i) => i.type !== 'hidden' && i.type !== 'password')
      .map((i) => ({ id: i.id || i.name, tipo: i.type, dica: i.placeholder })),
    botoes: [...document.querySelectorAll('button, a.btn, .btn')].map(txt).filter(Boolean).slice(0, 40),
    colunas: [...document.querySelectorAll('thead th')].map(txt).filter(Boolean).slice(0, 40),
    cards: [...document.querySelectorAll('.card-statistic-2, .card-body h4, .card-header h4')]
      .map(txt)
      .filter(Boolean)
      .slice(0, 20),
    tabelas: document.querySelectorAll('table').length,
    linhas: document.querySelectorAll('tbody tr').length,
  };
};

(async () => {
  const o = args(process.argv.slice(2));
  if (!process.env.RDV_USER || !process.env.RDV_PASS) {
    console.error('Faltou RDV_USER e RDV_PASS.');
    process.exit(1);
  }
  const lista = o.rotas
    ? MODULOS.filter((m) => o.rotas.split(',').includes(m[1]))
    : MODULOS;
  const saida = path.resolve(o.saida);
  fs.mkdirSync(path.join(saida, 'telas'), { recursive: true });

  const navegador = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
    userDataDir: path.join(os.tmpdir(), 'recon-rdv-perfil'),
  });
  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1600, height: 1000 });

  let rede = [];
  pagina.on('response', async (r) => {
    const u = r.url();
    if (!/Controller/.test(u) || /\.js(\?|$)/.test(u)) return;
    rede.push({ url: u.replace(BASE, '').split('?')[0], query: (u.split('?')[1] || '').slice(0, 120), status: r.status() });
  });

  // ------------------------------------------------------------------ login
  await pagina.goto(BASE + '/agendamentos/', { waitUntil: 'networkidle2', timeout: 90000 });
  if (pagina.url().includes('login')) {
    await pagina.type('input[name="auth_user"]', process.env.RDV_USER);
    await pagina.type('input[name="auth_pw"]', process.env.RDV_PASS);
    await Promise.all([
      pagina.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
      pagina.keyboard.press('Enter'),
    ]);
    await dorme(5000);
  }
  if (pagina.url().includes('login')) {
    console.error('Login não passou.');
    await navegador.close();
    process.exit(1);
  }
  console.log('login ok — varrendo', lista.length, 'módulos (só leitura)\n');

  const resumo = [];
  for (const [nome, rota] of lista) {
    const arquivo = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\W+/g, '-');
    rede = [];
    try {
      await pagina.goto(BASE + rota, { waitUntil: 'networkidle2', timeout: 90000 });
      await dorme(o.espera);
      // Único clique permitido: fechar o aviso de contrato que cobre a tela.
      await pagina.evaluate(() => {
        document
          .querySelectorAll('.modal.show .close, .modal.show [data-dismiss="modal"], .modal.show button.btn-link')
          .forEach((b) => /fechar|×|close/i.test(b.innerText || b.className) && b.click());
      });
      await dorme(800);

      const inv = await pagina.evaluate(INVENTARIO);
      const texto = await pagina.evaluate(() => document.body.innerText.slice(0, 4000));
      await pagina.screenshot({ path: path.join(saida, 'telas', `${arquivo}.png`), fullPage: false });
      const endpoints = [...new Set(rede.filter((r) => !/menu|conta|manifest|comunicados|voceSabia|tarifacao|dadosPessoais|plataforma/i.test(r.url)).map((r) => r.url))];

      fs.writeFileSync(
        path.join(saida, `${arquivo}.json`),
        JSON.stringify({ nome, rota, inventario: inv, endpoints, texto }, null, 1),
        'utf8',
      );
      resumo.push({
        nome,
        rota,
        abas: inv.abas.length,
        filtros: inv.selects.length + inv.campos.length,
        colunas: inv.colunas.length,
        linhas: inv.linhas,
        endpoints: endpoints.length,
      });
      console.log(
        `ok  ${nome.padEnd(26)} abas ${String(inv.abas.length).padStart(2)} · filtros ${String(inv.selects.length + inv.campos.length).padStart(3)} · colunas ${String(inv.colunas.length).padStart(2)} · endpoints ${endpoints.length}`,
      );
    } catch (e) {
      resumo.push({ nome, rota, erro: String(e.message).slice(0, 90) });
      console.log(`ERRO ${nome.padEnd(26)} ${String(e.message).slice(0, 80)}`);
    }
    await dorme(o.intervalo); // não martelar o servidor deles
  }

  fs.writeFileSync(path.join(saida, 'resumo.json'), JSON.stringify(resumo, null, 1), 'utf8');
  console.log('\nresumo em', path.join(saida, 'resumo.json'));
  await navegador.close();
})();
