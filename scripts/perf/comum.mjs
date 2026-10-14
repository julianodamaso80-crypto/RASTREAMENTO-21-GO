/**
 * Peças compartilhadas pelos scripts de medição de `scripts/perf/`.
 *
 * Tudo aqui é só leitura do lado do sistema medido: abre página, digita em
 * campo de busca, clica em card. Nada de salvar, exportar, bloquear ou mandar
 * comando — quem decide o que clicar é cada script, e cada um lista as ações
 * que faz.
 *
 * Relógio: os tempos são marcados com `Date.now()` (Node) e
 * `performance.timeOrigin + performance.now()` (página). Os dois leem o mesmo
 * relógio do sistema, na mesma máquina; a diferença entre eles fica na casa
 * de 1 ms, abaixo da resolução da espera (50 ms).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const puppeteer = require('puppeteer-core');

export const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(AQUI, '..', '..');

export const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

/** Intervalo de checagem das esperas — é a resolução de A e B. */
export const POLLING_MS = 50;

/**
 * Lê `.env.perf` (raiz do repositório ou pasta atual) sem dependência nova.
 * Não sobrescreve o que já veio do ambiente. O arquivo é ignorado pelo git.
 */
export function carregarEnvPerf() {
  for (const arq of [path.join(process.cwd(), '.env.perf'), path.join(RAIZ, '.env.perf')]) {
    if (!fs.existsSync(arq)) continue;
    for (const linha of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || linha.trim().startsWith('#')) continue;
      const valor = m[2].replace(/^["']|["']$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
    }
    return arq;
  }
  return null;
}

/** `--chave valor` e `--flag` (os nomes em `booleanos`). */
export function lerArgs(argv, padrao, booleanos = []) {
  const o = { ...padrao };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Argumento inesperado: ${a}`);
    const chave = a.slice(2);
    if (booleanos.includes(chave)) {
      o[chave] = true;
      continue;
    }
    if (!(chave in padrao)) throw new Error(`Argumento desconhecido: ${a}`);
    const valor = argv[++i];
    if (valor === undefined) throw new Error(`Faltou valor para ${a}`);
    o[chave] = typeof padrao[chave] === 'number' ? Number(valor) : valor;
  }
  return o;
}

/** Os quatro níveis da regra global — toda medição declara um. */
export const NIVEIS = {
  1: 'sintético',
  2: 'frontend local + API real',
  3: 'homologação completa',
  4: 'produção publicada',
};

export function exigirNivel(nivel) {
  const n = Number(nivel);
  if (!NIVEIS[n]) {
    throw new Error(
      'Declare o nível da medição com --nivel 1|2|3|4 (1 sintético · 2 frontend local + API real · 3 homologação · 4 produção).',
    );
  }
  return n;
}

export function carimbo(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/**
 * Desliga o gerenciador de senhas do perfil: na janela da RDV o dono digita a
 * senha, e o Chrome não pode nem oferecer para guardá-la.
 */
function semGerenciadorDeSenha(perfil) {
  const arq = path.join(perfil, 'Default', 'Preferences');
  let prefs = {};
  try {
    prefs = JSON.parse(fs.readFileSync(arq, 'utf8'));
  } catch {
    /* perfil novo */
  }
  prefs.credentials_enable_service = false;
  prefs.profile = { ...(prefs.profile || {}), password_manager_enabled: false };
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify(prefs));
}

export async function abrirNavegador({ visivel = false, perfil, largura = 1440, altura = 1000 } = {}) {
  const dir = perfil || fs.mkdtempSync(path.join(os.tmpdir(), 'perf-perfil-'));
  semGerenciadorDeSenha(dir);
  return puppeteer.launch({
    executablePath: CHROME,
    headless: visivel ? false : true,
    defaultViewport: { width: largura, height: altura },
    userDataDir: dir,
    args: [
      `--window-size=${largura},${altura + 120}`,
      // Sem isto `performance.memory` vem arredondado e em degraus.
      '--enable-precise-memory-info',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
}

/**
 * Instrumentação injetada em TODO documento antes do código da página:
 * long tasks, eventos (para o INP), LCP e utilitários usados pelas esperas.
 * Fica em `window.__perf` / `window.__perfUtil`.
 */
const INSTRUMENTACAO = () => {
  if (window.__perf) return;
  const origem = performance.timeOrigin;
  const perf = { longtasks: [], eventos: [], lcp: [], mud: null };
  window.__perf = perf;
  const observar = (tipo, cb, extra = {}) => {
    try {
      new PerformanceObserver((lista) => lista.getEntries().forEach(cb)).observe({
        type: tipo,
        buffered: true,
        ...extra,
      });
    } catch {
      /* tipo não suportado neste navegador */
    }
  };
  observar('longtask', (e) => perf.longtasks.push({ t: origem + e.startTime, d: e.duration }));
  observar(
    'event',
    (e) => {
      if (e.interactionId) perf.eventos.push({ t: origem + e.startTime, d: e.duration, id: e.interactionId, nome: e.name });
    },
    { durationThreshold: 16 },
  );
  observar('first-input', (e) => perf.eventos.push({ t: origem + e.startTime, d: e.duration, id: e.interactionId || -1, nome: e.name }));
  observar('largest-contentful-paint', (e) => perf.lcp.push({ t: origem + e.startTime, tam: e.size }));

  const visivel = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;
  };
  window.__perfUtil = {
    visivel,
    /** Existe algum elemento visível que casa com o seletor? */
    algumVisivel: (sel) => [...document.querySelectorAll(sel)].some(visivel),
    contarVisiveis: (sel) => [...document.querySelectorAll(sel)].filter(visivel).length,
    /** Primeiro "Última atualização…" / "vista …" escrito dentro de `raiz` (idade do dado). */
    ultimaAtualizacao: (raiz) => {
      if (!raiz) return null;
      const folha = [...raiz.querySelectorAll('*')].find(
        (e) => e.childElementCount === 0 && /^(Última atualização|vista )/.test(e.textContent.trim()),
      );
      return folha ? folha.textContent.trim() : null;
    },
    /**
     * Marca o primeiro quadro desenhado depois da próxima mudança no DOM
     * (dentro de `raizSel`, se dado). Mudança no próprio campo digitado não
     * conta: o eco da tecla não é resposta do sistema.
     */
    armarMudanca: (raizSel) => {
      perf.mud = null;
      const raiz = (raizSel && document.querySelector(raizSel)) || document.documentElement;
      const obs = new MutationObserver((lista) => {
        if (lista.every((m) => m.target && /^(INPUT|TEXTAREA)$/.test(m.target.nodeName))) return;
        obs.disconnect();
        requestAnimationFrame(() => {
          perf.mud = performance.timeOrigin + performance.now();
        });
      });
      obs.observe(raiz, { subtree: true, childList: true, attributes: true, characterData: true });
    },
  };
};

/** Coletor de rede (CDP) e console de uma página, com marcação por janela de tempo. */
export async function instrumentar(pagina) {
  await pagina.evaluateOnNewDocument(INSTRUMENTACAO);
  const cdp = await pagina.createCDPSession();
  await cdp.send('Network.enable');
  const reqs = new Map();
  const log = { pedidos: [], falhas: [], console: [] };
  cdp.on('Network.requestWillBeSent', (e) => {
    const r = { id: e.requestId, url: e.request.url, tipo: e.type, inicio: Date.now(), fim: null, bytes: 0, status: null };
    reqs.set(e.requestId, r);
    log.pedidos.push(r);
  });
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.status = e.response.status;
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId);
    if (!r) return;
    r.fim = Date.now();
    r.bytes = e.encodedDataLength || 0;
    if (r.status >= 400) log.falhas.push({ t: r.fim, url: r.url, status: r.status });
  });
  cdp.on('Network.loadingFailed', (e) => {
    const r = reqs.get(e.requestId);
    if (!r) return;
    r.fim = Date.now();
    // Cancelamento por navegação não é erro do sistema medido.
    if (!e.canceled) log.falhas.push({ t: r.fim, url: r.url, status: e.errorText });
  });
  pagina.on('console', (m) => {
    if (m.type() === 'error') log.console.push({ t: Date.now(), texto: m.text().slice(0, 300) });
  });
  pagina.on('pageerror', (e) => log.console.push({ t: Date.now(), texto: `pageerror: ${String(e.message || e).slice(0, 300)}` }));

  return {
    cdp,
    log,
    /** XHR/fetch iniciados depois de `t0` e ainda abertos. */
    abertosDesde: (t0) =>
      log.pedidos.filter((r) => r.inicio >= t0 && r.fim === null && (r.tipo === 'XHR' || r.tipo === 'Fetch')),
    /** Último fim de XHR/fetch iniciado na janela. */
    ultimoFimXhr: (t0) =>
      Math.max(
        0,
        ...log.pedidos
          .filter((r) => r.inicio >= t0 && r.fim !== null && (r.tipo === 'XHR' || r.tipo === 'Fetch'))
          .map((r) => r.fim),
      ),
    resumo: (t0, t1) => {
      const naJanela = (x) => x.t >= t0 && x.t <= t1;
      const pedidos = log.pedidos.filter((r) => r.inicio >= t0 && r.inicio <= t1);
      return {
        reqs: pedidos.length,
        bytes: pedidos.reduce((s, r) => s + (r.bytes || 0), 0),
        falhas: log.falhas.filter(naJanela),
        errosConsole: log.console.filter(naJanela),
      };
    },
    limparCache: () => cdp.send('Network.clearBrowserCache'),
  };
}

/**
 * Espera um predicado da página ficar verdadeiro e devolve o instante (epoch
 * ms, relógio da página) em que ele foi visto verdadeiro.
 *
 * Convenção: o predicado devolve `Date.now()` quando a condição vale e `false`
 * quando não. (Embrulhar com `new Function` dentro da página seria mais
 * cômodo, mas esbarra na CSP de sites sem 'unsafe-eval'.)
 *
 * Sobrevive à troca de documento (login → painel): se o contexto morrer no
 * meio, tenta de novo até o prazo.
 */
export async function esperar(pagina, predicado, arg, prazoMs = 60000) {
  const limite = Date.now() + prazoMs;
  for (;;) {
    const resta = limite - Date.now();
    if (resta <= 0) throw new Error('prazo esgotado');
    try {
      const h = await pagina.waitForFunction(predicado, { polling: POLLING_MS, timeout: resta }, arg ?? null);
      return await h.jsonValue();
    } catch (e) {
      const msg = String(e && e.message);
      if (/context was destroyed|Execution context|detached|Target closed/i.test(msg)) {
        await dorme(POLLING_MS);
        continue;
      }
      if (/timeout|Waiting failed/i.test(msg)) throw new Error('prazo esgotado');
      throw e;
    }
  }
}

/** Arma o detector de "primeira mudança visual" no documento atual. */
export async function armarMudanca(pagina, raizSel = null) {
  await pagina.evaluate((s) => window.__perfUtil && window.__perfUtil.armarMudanca(s), raizSel);
}

/** Navegação de página (meta: B p75 ≤ 2,5 s) × interação na página (A p95 ≤ 100 ms, INP p75 ≤ 200 ms). */
export const TIPO_DA_ACAO = {
  login: 'navegacao',
  'abrir-painel': 'navegacao',
  'abrir-mapa': 'navegacao',
  'buscar-placa': 'interacao',
  'abrir-detalhe': 'interacao',
  'abrir-historico': 'interacao',
  'abrir-estoque': 'navegacao',
  'buscar-imei': 'interacao',
  'abrir-estoque-mapa': 'navegacao',
};

/** Nome de cada ação na tabela do dono. */
export const ROTULO_DA_ACAO = {
  login: 'Login',
  'abrir-painel': 'Abrir o painel (Dashboard / Conectividade)',
  'abrir-mapa': 'Abrir o mapa',
  'buscar-placa': 'Buscar placa no mapa',
  'abrir-detalhe': 'Abrir detalhe do veículo',
  'abrir-historico': 'Histórico de 24 h',
  'abrir-estoque': 'Abrir o estoque',
  'buscar-imei': 'Buscar IMEI no estoque',
  'abrir-estoque-mapa': 'Abrir o mapa do estoque',
};

/**
 * A = primeira mudança visual depois de `t0`. Prefere o quadro após a
 * primeira mutação do DOM; se a ação trocou de documento, usa o FCP do
 * documento novo (primeira pintura com conteúdo).
 */
export async function lerPrimeiroFeedback(pagina, t0) {
  try {
    return await pagina.evaluate((t0) => {
      const cands = [];
      if (window.__perf && window.__perf.mud && window.__perf.mud >= t0) cands.push(window.__perf.mud);
      if (performance.timeOrigin >= t0 - 5) {
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        if (fcp) cands.push(performance.timeOrigin + fcp.startTime);
      }
      return cands.length ? Math.min(...cands) : null;
    }, t0);
  } catch {
    return null;
  }
}

/** Long tasks, INP aproximado e LCP dentro de [t0, t1]. */
export async function lerVitais(pagina, t0, t1) {
  try {
    return await pagina.evaluate(
      (t0, t1) => {
        const p = window.__perf || { longtasks: [], eventos: [], lcp: [] };
        const lt = p.longtasks.filter((x) => x.t >= t0 && x.t <= t1);
        // INP sem web-vitals: maior duração por interação na janela. Com menos
        // de 50 interações o INP oficial também é o máximo.
        const porInteracao = new Map();
        for (const e of p.eventos) {
          if (e.t < t0 || e.t > t1) continue;
          porInteracao.set(e.id, Math.max(porInteracao.get(e.id) || 0, e.d));
        }
        const inp = porInteracao.size ? Math.max(...porInteracao.values()) : null;
        const lcps = p.lcp.filter((x) => x.t >= t0 && x.t <= t1);
        return {
          long_n: lt.length,
          long_total_ms: Math.round(lt.reduce((s, x) => s + x.d, 0)),
          long_max_ms: Math.round(lt.reduce((m, x) => Math.max(m, x.d), 0)),
          inp_ms: inp === null ? null : Math.round(inp),
          lcp_ms: lcps.length ? Math.round(lcps[lcps.length - 1].t - t0) : null,
        };
      },
      t0,
      t1,
    );
  } catch {
    return { long_n: null, long_total_ms: null, long_max_ms: null, inp_ms: null, lcp_ms: null };
  }
}

// ───────────────────────────────────────────────────────────── idade do dado

/** Fuso das datas que as telas escrevem (Brasília, sem horário de verão). */
const OFFSET_TELA_MIN = Number(process.env.PERF_TZ_OFFSET_MIN ?? -180);

const RELATIVOS = [
  [/h[áa]\s+poucos\s+segundos/i, () => [0, 45]],
  [/h[áa]\s+(\d+)\s+segundos?/i, (n) => [n, n]],
  [/h[áa]\s+um\s+minuto/i, () => [45, 90]],
  [/h[áa]\s+(\d+)\s+minutos?/i, (n) => [n * 60 - 30, n * 60 + 30]],
  [/h[áa]\s+uma\s+hora/i, () => [45 * 60, 90 * 60]],
  [/h[áa]\s+(\d+)\s+horas?/i, (n) => [n * 3600 - 1800, n * 3600 + 1800]],
  [/h[áa]\s+um\s+dia/i, () => [22 * 3600, 36 * 3600]],
  [/h[áa]\s+(\d+)\s+dias?/i, (n) => [n * 86400 - 43200, n * 86400 + 43200]],
  [/h[áa]\s+um\s+m[êe]s/i, () => [26 * 86400, 45 * 86400]],
  [/h[áa]\s+(\d+)\s+meses/i, (n) => [n * 30.4 * 86400 - 15 * 86400, n * 30.4 * 86400 + 15 * 86400]],
  [/\bagora\b/i, () => [0, 30]],
];

/**
 * Idade do dado mais recente escrito num trecho da tela, em segundos.
 * Datas absolutas (dd/mm/aaaa hh:mm[:ss]) dão idade exata; frases relativas
 * ("há 3 minutos") dão uma faixa — devolvemos o meio e a faixa, sem fingir
 * precisão que a tela não tem.
 */
export function idadeDoTexto(texto, agora = Date.now()) {
  if (!texto) return null;
  const achados = [];
  const reAbs = /(\d{2})\/(\d{2})\/(\d{4})[^\d]{1,6}(\d{2}):(\d{2})(?::(\d{2}))?/g;
  let m;
  while ((m = reAbs.exec(texto))) {
    const [, d, mes, a, h, mi, s] = m;
    const utc = Date.UTC(+a, +mes - 1, +d, +h, +mi, +(s || 0)) - OFFSET_TELA_MIN * 60000;
    const idade = (agora - utc) / 1000;
    if (idade > -120) achados.push({ idade_s: Math.max(0, Math.round(idade)), faixa: null, trecho: m[0] });
  }
  for (const [re, faixa] of RELATIVOS) {
    const g = new RegExp(re.source, 'gi');
    while ((m = g.exec(texto))) {
      const [min, max] = faixa(m[1] ? Number(m[1]) : undefined);
      achados.push({ idade_s: Math.round((min + max) / 2), faixa: [Math.max(0, Math.round(min)), Math.round(max)], trecho: m[0] });
    }
  }
  if (achados.length === 0) return null;
  return achados.reduce((a, b) => (b.idade_s < a.idade_s ? b : a));
}

// ──────────────────────────────────────────────────────────────── estatística

/** Percentil por posição (nearest-rank) — sem interpolar amostra pequena. */
export function percentil(valores, p) {
  const v = valores.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const pos = Math.max(1, Math.ceil((p / 100) * v.length));
  return v[pos - 1];
}

export function estatistica(valores) {
  const v = valores.filter((x) => typeof x === 'number' && Number.isFinite(x));
  return {
    n: v.length,
    mediana: percentil(v, 50),
    p75: percentil(v, 75),
    p95: percentil(v, 95),
    // p99 só com 20 amostras ou mais (regra global).
    p99: v.length >= 20 ? percentil(v, 99) : null,
    min: v.length ? Math.min(...v) : null,
    max: v.length ? Math.max(...v) : null,
  };
}

/**
 * "Inconclusiva" quando a diferença entre medianas fica dentro da variação:
 * |diff| < max(maior espalhamento p95−mediana dos dois lados, 10 % da maior mediana).
 */
export function compararMedianas(a, b) {
  if (!a || !b || a.mediana === null || b.mediana === null) return { veredito: 'sem dados', diff: null, limiar: null };
  const espalhamento = Math.max((a.p95 ?? a.mediana) - a.mediana, (b.p95 ?? b.mediana) - b.mediana);
  const limiar = Math.max(espalhamento, 0.1 * Math.max(a.mediana, b.mediana));
  const diff = a.mediana - b.mediana;
  if (Math.abs(diff) < limiar) return { veredito: 'inconclusiva', diff, limiar };
  return { veredito: diff < 0 ? 'mais rápido' : 'mais lento', diff, limiar };
}

export function paraCsv(linhas, colunas) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [colunas.join(','), ...linhas.map((l) => colunas.map((c) => esc(l[c])).join(','))].join('\n') + '\n';
}

export const ms = (v) => (v === null || v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2).replace('.', ',')} s` : `${Math.round(v)} ms`);

export function idadeLegivel(s) {
  if (s === null || s === undefined) return '—';
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

// ──────────────────────────────────────────────────────────── nosso painel

/** API do painel a partir da URL do frontend (sobrescreva com PERF_API). */
export function apiDoPainel(base) {
  if (process.env.PERF_API) return process.env.PERF_API.replace(/\/$/, '');
  const u = new URL(base);
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return `${u.protocol}//${u.hostname}:3001`;
  return `${u.protocol}//api.${u.hostname.replace(/^www\./, '')}`;
}

/** Versão publicada do backend (`/api/v1/health`) e o build do frontend. */
export async function versaoDoPainel(base, pagina) {
  const v = { backend: null, frontend: null };
  try {
    const r = await fetch(`${apiDoPainel(base)}/api/v1/health`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const ver = (j.data || j).version || {};
    v.backend = `${ver.gitSha ?? '?'} (${ver.builtAt ?? '?'})`;
  } catch (e) {
    v.backend = `indisponível: ${String(e.message || e).slice(0, 80)}`;
  }
  if (pagina) {
    try {
      // App Router não expõe buildId em variável; o caminho do manifesto tem.
      v.frontend = await pagina.evaluate(() => {
        const s = [...document.querySelectorAll('script[src]')]
          .map((e) => e.getAttribute('src'))
          .find((x) => /_next\/static\/(?!chunks|css|media)[^/]+\//.test(x));
        const m = s && s.match(/_next\/static\/([^/]+)\//);
        return m ? m[1] : 'buildId não exposto';
      });
    } catch {
      v.frontend = 'desconhecido';
    }
  }
  return v;
}

/** Seletores do login do painel — `components/auth/login-form.tsx`. */
export const LOGIN_NOSSO = {
  usuario: '#email',
  senha: '#password',
  enviar: 'button[type="submit"]',
};

/**
 * Entra no painel com PERF_USER/PERF_PASS (conta de teste ou do dono, no
 * `.env.perf`). A senha nunca é impressa nem gravada em resultado.
 */
export async function entrarNoPainel(pagina, base) {
  const usuario = process.env.PERF_USER;
  const senha = process.env.PERF_PASS;
  if (!usuario || !senha) throw new Error('Faltou PERF_USER/PERF_PASS (no ambiente ou em .env.perf).');
  await pagina.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await pagina.evaluate(() => localStorage.removeItem('token'));
  await pagina.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await pagina.waitForSelector(LOGIN_NOSSO.usuario, { visible: true, timeout: 60000 });
  await pagina.type(LOGIN_NOSSO.usuario, usuario);
  await pagina.type(LOGIN_NOSSO.senha, senha);
  const t0 = Date.now();
  await armarMudanca(pagina);
  await pagina.click(LOGIN_NOSSO.enviar);
  return t0;
}

/** Elemento "carregando" do painel: Skeleton, ícone girando, placeholder do mapa dinâmico. */
export const OCUPADO_NOSSO = '[data-slot="skeleton"], .animate-spin, .animate-pulse.h-full.w-full';

export function pastaDeSaida(dir) {
  const p = path.resolve(dir);
  fs.mkdirSync(p, { recursive: true });
  return p;
}
