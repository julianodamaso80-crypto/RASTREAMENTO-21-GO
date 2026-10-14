#!/usr/bin/env node
/**
 * F5 — a lista do mapa do estoque em uso prolongado.
 *
 * Roteiro (o de um operador num turno):
 *   1. abre /estoque/mapa;
 *   2. "Mostrar mais equipamentos" 10× (200 → 2.200 cards) e rola a lista;
 *   3. busca PERF_IMEI e limpa a busca (a busca recomeça a janela em 200 —
 *      comportamento de propósito de stock-list-window), então "Mostrar mais"
 *      10× de novo, para o teste prolongado rodar com a lista cheia;
 *   4. seleciona um item lá do fim da lista (o mapa voa até ele);
 *   5. fica parado `--minutos` (padrão 20) com a aba visível — o painel
 *      recarrega o estoque a cada 15 s — e a cada 60 s anota long tasks,
 *      memória (performance.memory), nós no DOM e cards na lista.
 *
 * Critério (task F5): em toda janela de 90 s, soma das long tasks < 3.000 ms
 * e nenhuma long task ≥ 300 ms. PASS/FAIL no fim; série completa em JSON.
 *
 * Uso:
 *   MSYS_NO_PATHCONV=1 node scripts/perf/uso-prolongado-estoque.mjs \
 *     --base http://localhost:3000 --nivel 2 [--minutos 20] [--visivel]
 *   Env: PERF_USER, PERF_PASS, PERF_IMEI.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  abrirNavegador,
  carimbo,
  carregarEnvPerf,
  dorme,
  entrarNoPainel,
  esperar,
  exigirNivel,
  instrumentar,
  lerArgs,
  ms,
  NIVEIS,
  OCUPADO_NOSSO,
  pastaDeSaida,
  versaoDoPainel,
} from './comum.mjs';

const CARD = 'button span.font-mono.text-xs.font-semibold';
const BUSCA = 'input[placeholder^="IMEI, ICCID"]';
const JANELA_MS = 90_000;
const LIMITE_TOTAL_MS = 3000;
const LIMITE_MAX_MS = 300;

const contarCards = (pagina) => pagina.evaluate((s) => document.querySelectorAll(s).length, CARD);

/** Clica "Mostrar mais equipamentos" até `vezes` ou até acabar a lista. */
async function mostrarMais(pagina, vezes) {
  const tempos = [];
  for (let i = 0; i < vezes; i += 1) {
    const botao = await pagina.evaluateHandle(
      () => [...document.querySelectorAll('button')].find((b) => /^Mostrar mais equipamentos/.test(b.innerText.trim())) || null,
    );
    const el = botao.asElement();
    if (!el) break;
    const antes = await contarCards(pagina);
    const t0 = Date.now();
    await el.click();
    await esperar(pagina, (args) => (document.querySelectorAll(args.s).length > args.n ? Date.now() : false), { s: CARD, n: antes }, 60000);
    tempos.push(Date.now() - t0);
  }
  return tempos;
}

async function rolarLista(pagina) {
  await pagina.evaluate(async (s) => {
    const card = document.querySelector(s);
    const cont = card && card.closest('.overflow-y-auto');
    if (!cont) return;
    for (let y = 0; y < cont.scrollHeight; y += 800) {
      cont.scrollTop = y;
      await new Promise((r) => setTimeout(r, 60));
    }
    cont.scrollTop = 0;
  }, CARD);
}

async function amostrar(pagina) {
  return pagina.evaluate((s) => {
    const m = performance.memory || {};
    return {
      t: Date.now(),
      heapUsadoMB: m.usedJSHeapSize ? +(m.usedJSHeapSize / 2 ** 20).toFixed(1) : null,
      heapTotalMB: m.totalJSHeapSize ? +(m.totalJSHeapSize / 2 ** 20).toFixed(1) : null,
      nos: document.getElementsByTagName('*').length,
      cards: document.querySelectorAll(s).length,
      longtasks: (window.__perf && window.__perf.longtasks.slice()) || [],
    };
  }, CARD);
}

async function main() {
  carregarEnvPerf();
  const o = lerArgs(
    process.argv.slice(2),
    { base: process.env.PERF_BASE || 'http://localhost:3000', nivel: '', flags: '', minutos: 20, saida: 'scripts/perf/resultados' },
    ['visivel'],
  );
  const nivel = exigirNivel(o.nivel);
  const imei = process.env.PERF_IMEI;
  if (!imei) throw new Error('Faltou PERF_IMEI (ambiente ou .env.perf).');
  const base = o.base.replace(/\/$/, '');

  const navegador = await abrirNavegador({ visivel: o.visivel });
  const pagina = (await navegador.pages())[0] || (await navegador.newPage());
  const coletor = await instrumentar(pagina);
  const relatorio = { nivel, nivelDescricao: NIVEIS[nivel], base, flags: o.flags, minutos: o.minutos, roteiro: {}, serie: [], janelas: [] };
  // Gravado a cada amostra e no fim: uma queda no minuto 18 não perde a série.
  const arq = path.join(pastaDeSaida(o.saida), `${carimbo()}-uso-prolongado-estoque.json`);
  const gravar = () => fs.writeFileSync(arq, JSON.stringify(relatorio, null, 1), 'utf8');

  try {
    await entrarNoPainel(pagina, base);
    await esperar(pagina, (oc) => (location.pathname === '/dashboard' && !window.__perfUtil.algumVisivel(oc) ? Date.now() : false), OCUPADO_NOSSO, 90000);
    relatorio.versao = await versaoDoPainel(base, pagina);
    console.log(`nível ${nivel} (${NIVEIS[nivel]}) · ${base} · backend ${relatorio.versao.backend} · frontend ${relatorio.versao.frontend} · flags ${o.flags || '—'}`);

    await pagina.goto(`${base}/estoque/mapa`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await esperar(pagina, (s) => (document.querySelector(s) ? Date.now() : false), CARD, 90000);
    const inicio = Date.now();

    relatorio.roteiro.mostrarMais1 = await mostrarMais(pagina, 10);
    relatorio.roteiro.cardsDepois1 = await contarCards(pagina);
    console.log(`"Mostrar mais" ×${relatorio.roteiro.mostrarMais1.length}: ${relatorio.roteiro.mostrarMais1.map(ms).join(', ')} → ${relatorio.roteiro.cardsDepois1} cards`);
    await rolarLista(pagina);

    const t0Busca = Date.now();
    await pagina.type(BUSCA, imei);
    await esperar(
      pagina,
      (a) => ([...document.querySelectorAll(a.s)].some((e) => e.textContent.trim() === a.imei) && document.querySelectorAll(a.s).length < 50 ? Date.now() : false),
      { s: CARD, imei },
      30000,
    );
    relatorio.roteiro.buscaMs = Date.now() - t0Busca;
    await pagina.click(BUSCA, { clickCount: 3 });
    await pagina.keyboard.press('Backspace');
    await dorme(800);
    relatorio.roteiro.mostrarMais2 = await mostrarMais(pagina, 10);
    relatorio.roteiro.cardsDepois2 = await contarCards(pagina);

    // Um item lá do fim: o card de índice ~90 % da lista desenhada.
    const indice = Math.floor(relatorio.roteiro.cardsDepois2 * 0.9);
    const longe = await pagina.evaluateHandle((s, i) => document.querySelectorAll(s)[i].closest('button'), CARD, indice);
    await longe.asElement().evaluate((e) => e.scrollIntoView({ block: 'center' }));
    const t0Sel = Date.now();
    await longe.asElement().click();
    await dorme(1500);
    relatorio.roteiro.selecaoIndice = indice;
    relatorio.roteiro.selecaoMs = Date.now() - t0Sel;
    console.log(`busca ${ms(relatorio.roteiro.buscaMs)} · lista refeita com ${relatorio.roteiro.cardsDepois2} cards · selecionado o card nº ${indice}`);
    console.log(`parado ${o.minutos} min, amostra a cada 60 s:\n`);

    const fimOcioso = Date.now() + o.minutos * 60_000;
    let ultima = await amostrar(pagina);
    let todas = ultima.longtasks;
    while (Date.now() < fimOcioso) {
      await dorme(Math.min(60_000, Math.max(0, fimOcioso - Date.now())));
      const a = await amostrar(pagina);
      todas = a.longtasks;
      const novas = todas.filter((x) => x.t > ultima.t);
      const linha = {
        minuto: Math.round((a.t - inicio) / 60000),
        heapUsadoMB: a.heapUsadoMB,
        heapTotalMB: a.heapTotalMB,
        nos: a.nos,
        cards: a.cards,
        longN: novas.length,
        longTotalMs: Math.round(novas.reduce((s, x) => s + x.d, 0)),
        longMaxMs: Math.round(novas.reduce((m, x) => Math.max(m, x.d), 0)),
      };
      relatorio.serie.push(linha);
      gravar();
      console.log(
        `min ${String(linha.minuto).padStart(3)} · heap ${linha.heapUsadoMB} MB · nós ${linha.nos} · cards ${linha.cards} · long tasks ${linha.longN} (soma ${ms(linha.longTotalMs)}, máx ${ms(linha.longMaxMs)})`,
      );
      ultima = a;
    }

    // Janelas deslizantes de 90 s (passo de 15 s, o ritmo do recarregamento),
    // só no período ocioso — o roteiro inicial tem os próprios tempos acima.
    const inicioOcioso = fimOcioso - o.minutos * 60_000;
    for (let t = inicioOcioso; t + JANELA_MS <= fimOcioso; t += 15_000) {
      const lt = todas.filter((x) => x.t >= t && x.t < t + JANELA_MS);
      relatorio.janelas.push({
        inicioMin: +((t - inicio) / 60000).toFixed(2),
        totalMs: Math.round(lt.reduce((s, x) => s + x.d, 0)),
        maxMs: Math.round(lt.reduce((m, x) => Math.max(m, x.d), 0)),
      });
    }
    relatorio.erros = { console: coletor.log.console.length, rede: coletor.log.falhas.length };
  } finally {
    await navegador.close().catch(() => {});
    gravar();
  }

  const piorTotal = Math.max(0, ...relatorio.janelas.map((j) => j.totalMs));
  const piorMax = Math.max(0, ...relatorio.janelas.map((j) => j.maxMs));
  const s = relatorio.serie;
  const heap0 = s.length ? s[0].heapUsadoMB : null;
  const heapN = s.length ? s[s.length - 1].heapUsadoMB : null;
  const okTotal = piorTotal < LIMITE_TOTAL_MS;
  const okMax = piorMax < LIMITE_MAX_MS;
  // Lista curta (menos de 10 "Mostrar mais") não testou o cenário de 2.200
  // cards: o resultado vale, mas não é PASS limpo.
  const cliques = Math.min(relatorio.roteiro.mostrarMais1?.length ?? 0, relatorio.roteiro.mostrarMais2?.length ?? 0);
  const aviso = cliques < 10 ? `AVISO: só ${cliques} cliques em "Mostrar mais" (lista acabou antes de 10) — ${relatorio.roteiro.cardsDepois2 ?? '?'} cards, não 2.200` : null;
  relatorio.veredito = { piorTotal90sMs: piorTotal, piorLongTaskMs: piorMax, okTotal, okMax, heapInicialMB: heap0, heapFinalMB: heapN, aviso };
  gravar();

  console.log('');
  console.log(`${okTotal ? 'PASS' : 'FAIL'}  pior janela de 90 s: ${ms(piorTotal)} de long tasks (limite < ${ms(LIMITE_TOTAL_MS)})`);
  console.log(`${okMax ? 'PASS' : 'FAIL'}  maior long task: ${ms(piorMax)} (limite < ${ms(LIMITE_MAX_MS)})`);
  if (aviso) console.log(aviso);
  console.log(`info  heap ${heap0} MB → ${heapN} MB · erros console ${relatorio.erros?.console ?? '?'} · rede ${relatorio.erros?.rede ?? '?'}`);

  console.log(`série completa: ${arq}`);
  // 0 = PASS limpo · 1 = FAIL · 3 = PASS com aviso (lista curta).
  process.exit(!(okTotal && okMax) ? 1 : aviso ? 3 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(2);
});
